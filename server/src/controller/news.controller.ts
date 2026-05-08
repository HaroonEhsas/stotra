import { Request, Response } from "express";

import dotenv from "dotenv";
dotenv.config();

let searchApi: any = null;
if (process.env.STOTRA_NEWSFILTER_API && process.env.STOTRA_NEWSFILTER_API !== "") {
	try {
		const { SearchApi } = require("financial-news-api");
		searchApi = SearchApi(process.env.STOTRA_NEWSFILTER_API);
	} catch (e) {
		console.warn("Failed to initialize financial-news-api:", e);
	}
}

// Cache the results for 15 minutes
import NodeCache from "node-cache";
const cache = new NodeCache({ stdTTL: 15 * 60 });

const getNews = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['News']
	*/
	var symbol = req.params.symbol || "";
	const symbolQuery = symbol !== "" ? "symbols:" + symbol + " AND " : "";

	if (cache.has(symbol + "-news")) {
		res.status(200).json(cache.get(symbol + "-news"));
		return;
	}

	// If no API key for NewsFilter is provided, use Yahoo Finance API
	if (!searchApi) {
		console.warn("No NewsFilter API key provided. Using Yahoo Finance API.");
		yahooNews(symbol)
			.then((news) => {
				res.status(200).json(news);
			})
			.catch((err: any) => {
				console.log(err);
				res.status(500).json(err);
			});
		return;
	}

	const query = {
		queryString:
			symbolQuery +
			"(source.id:bloomberg OR source.id:reuters OR source.id:cnbc OR source.id:wall-street-journal)",
		from: 0,
		size: 10,
	};

	searchApi
		.getNews(query)
		.then((response: any) => {
			let news = response.articles.map((newsItem: any) => {
				return {
					title: newsItem.title,
					publishedAt: newsItem.publishedAt,
					source: newsItem.source.name,
					sourceUrl: newsItem.sourceUrl,
					symbols: newsItem.symbols,
					description: newsItem.description,
				};
			});
			cache.set(symbol + "-news", news);
			res.status(200).json(news);
		})
		.catch((err: any) => {
			if (err.response && err.response.data && err.response.data.message) {
				// Retry with Yahoo Finance API if Newsfilter quota is exceeded
				yahooNews(symbol)
					.then((news) => {
						res.status(200).json(news);
					})
					.catch((err: any) => {
						console.log(err);
						res.status(500).json(err);
					});
			} else {
				console.log(err);
				res.status(500).json(err);
			}
		});
};

function yahooNews(symbol: string): Promise<any> {
	// Yahoo Finance API is no longer reliably available for news
	// Return empty news array as fallback
	return new Promise((resolve) => {
		const news: any[] = [];
		cache.set(symbol + "-news", news);
		resolve(news);
	});
}

export default { getNews };
