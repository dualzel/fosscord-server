import "dotenv/config";
import https from "https";
import Fosscord from "fosscord-gopnik";
import mysql from "mysql2";

const dbConn = mysql.createConnection(process.env.DATABASE as string);
const executePromise = (sql: string, args: any[]) => new Promise((resolve, reject) => dbConn.execute(sql, args, (err, res) => { if (err) reject(err); else resolve(res); }));

const instance = {
	app: process.env.INSTANCE_WEB_APP as string,
	api: process.env.INSTANCE_API as string,
	cdn: process.env.INSTANCE_CDN as string,
	token: process.env.INSTANCE_TOKEN as string,
};

const client = new Fosscord.Client({
	intents: [],
	http: {
		api: instance.api,
		cdn: instance.cdn
	}
});

const gatewayMeasure = async (name: string) => {
	const time = Math.max(client.ws.ping, 0);
	await savePerf(time, name, '');
	console.log(`${name} took ${time}ms`);
};

client.on("ready", () => {
	console.log(`Ready on gateway as ${client.user!.tag}`);
});

client.on("error", (error) => {
	console.log(`Gateway error`, error);
});

client.on("warn", (msg) => {
	console.log(`Gateway warning:`, msg);
});

const savePerf = async (time: number, name: string, error?: string | Error) => {
	if (error && typeof error != "string") error = error.message;
	try {
		await executePromise("INSERT INTO performance (value, endpoint, timestamp, error) VALUES (?, ?, ?, ?)", [time, name, new Date(), error ?? null]);
		await executePromise("DELETE FROM performance WHERE DATE(timestamp) < now() - interval ? DAY", [process.env.RETENTION_DAYS]);
	}
	catch (e) {
		console.error(e);
	}
};

const makeTimedRequest = (path: string, body?: object): Promise<number> => new Promise((resolve, reject) => {
	const opts = {
		hostname: new URL(path).hostname,
		port: 443,
		path: new URL(path).pathname,
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			"Authorization": instance.token,
		},
		timeout: 1000,
	};

	let start: number, end: number;
	const req = https.request(opts, res => {
		if (res.statusCode! < 200 || res.statusCode! > 300) {
			return reject(`${res.statusCode} ${res.statusMessage}`);
		}

		res.on("data", (data) => {
		});

		res.on("end", () => {
			end = Date.now();
			resolve(end - start);
		})
	});

	req.on("finish", () => {
		if (body) req.write(JSON.stringify(body));
		start = Date.now();
	});

	req.on("error", (error) => {
		reject(error);
	});

	req.end();
});

const measureApi = async (name: string, path: string, body?: object) => {
	let error, time = -1;
	try {
		time = await makeTimedRequest(path, body);
	}
	catch (e) {
		error = e as Error | string;
	}

	console.log(`${name} took ${time}ms ${(error ? "with error" : "")}`, error ?? "");

	await savePerf(time, name, error);
};

const app = async () => {
	await new Promise((resolve) => dbConn.connect(resolve));
	console.log("Connected to db");
	// await client.login(instance.token);

	console.log(`Monitoring performance for instance at ${new URL(instance.api).hostname}`);

	const doMeasurements = async () => {
		await measureApi("ping", `${instance.api}/ping`);
		await measureApi("users/@me", `${instance.api}/users/@me`);
		await measureApi("login", `${instance.app}/login`);
		// await gatewayMeasure("websocketPing");

		setTimeout(doMeasurements, parseInt(process.env.MEASURE_INTERVAL as string));
	};

	doMeasurements();
};

app();