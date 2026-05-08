import mongoose from "mongoose";
mongoose.Promise = global.Promise;

require("dotenv").config();

let uri: string;

if (process.env.STOTRA_MONGODB_CLUSTER) {
	// Atlas connection
	const password = process.env.STOTRA_MONGODB_PASSWORD;
	uri =
		"mongodb+srv://" +
		process.env.STOTRA_MONGODB_USERNAME +
		":" +
		password +
		"@" +
		process.env.STOTRA_MONGODB_CLUSTER +
		"/users?authMechanism=DEFAULT&retryWrites=true&w=majority";
} else {
	// Local MongoDB connection
	const host = process.env.STOTRA_MONGODB_HOST || "localhost";
	const port = process.env.STOTRA_MONGODB_PORT || "27017";
	const db = process.env.STOTRA_MONGODB_DB || "stotra_db";
	uri = `mongodb://${host}:${port}/${db}`;
}

mongoose.connect(uri);

const db = mongoose.connection;

db.on("error", console.error.bind(console, "connection error:"));

db.once("open", () => {
	console.log("Connected to Database");
});

module.exports = db;
