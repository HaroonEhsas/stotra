import { Express, Request, Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
const version = "0.0.0";
import dotenv from "dotenv";
dotenv.config();

function swaggerDocs(app: Express, port: number) {
	try {
		const options = {
			definition: {
				openapi: "3.0.0",
				info: {
					title: "Stock Trading Simulator API",
					version,
					description: "A REST API for the Stock Trading Simulator",
				},
				components: {
					securitySchemes: {
						bearerAuth: {
							type: "http",
							scheme: "bearer",
							bearerFormat: "JWT",
						},
					},
				},
				security: [{ bearerAuth: [] }],
			},
			apis: ["./dist/routes.js"],
		};
		const swaggerDocument = swaggerJsdoc(options);
		app.use(
			"/api/docs",
			swaggerUi.serve,
			swaggerUi.setup(swaggerDocument, {
				swaggerOptions: { persistAuthorization: true },
			}),
		);
		console.log(`Swagger docs available at http://0.0.0.0:${port}/api/docs`);
	} catch (e) {
		console.warn("Swagger setup skipped:", (e as Error).message);
	}
}

exports.swaggerDocs = swaggerDocs;
