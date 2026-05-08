import mongoose from "mongoose";
mongoose.Promise = global.Promise;

require("dotenv").config();

let uri: string;

if (process.env.STOTRA_MONGODB_CLUSTER) {
	// Atlas connection
	const password = encodeURIComponent(process.env.STOTRA_MONGODB_PASSWORD || "");
	uri =
		"mongodb+srv://" +
		process.env.STOTRA_MONGODB_USERNAME +
		":" +
		password +
		"@" +
		process.env.STOTRA_MONGODB_CLUSTER +
		".mongodb.net/users?retryWrites=true&w=majority";
} else {
	// Local MongoDB connection
	const host = process.env.STOTRA_MONGODB_HOST || "localhost";
	const port = process.env.STOTRA_MONGODB_PORT || "27017";
	const db = process.env.STOTRA_MONGODB_DB || "stotra_db";
	uri = `mongodb://${host}:${port}/${db}`;
}

mongoose.connect(uri).catch((err) => {
	console.error("MongoDB connection failed:", err.message);
});

const db = mongoose.connection;

db.on("error", (err) => {
	console.error("MongoDB connection error:", err.message);
});

db.once("open", () => {
	console.log("Connected to Database");
});

module.exports = db;
