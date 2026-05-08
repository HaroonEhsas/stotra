import axios from "axios";
import tokens from "./tokens.service";

const API_BASE = window.location.hostname === "localhost"
	? "/api"
	: "https://stotra-2.onrender.com/api";

const instance = axios.create({
	baseURL: API_BASE,
	headers: {
		"Content-Type": "application/json",
	},
});

instance.interceptors.request.use(
	(config) => {
		const token = tokens.getToken();
		if (token) {
			config.headers["Authorization"] = "Bearer " + token;
		}
		return config;
	},
	(error) => {
		return Promise.reject(error);
	},
);

export default instance;
