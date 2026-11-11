CREATE TABLE `gateway_request_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` varchar(64) NOT NULL,
	`provider` varchar(32) NOT NULL,
	`model` varchar(128) NOT NULL,
	`strategy` varchar(32) NOT NULL,
	`latencyMs` int NOT NULL,
	`success` int NOT NULL DEFAULT 1,
	`error` text,
	`fallbackUsed` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gateway_request_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `routing_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategy` enum('round-robin','cheapest-first','fastest-first','fallback-on-failure') NOT NULL DEFAULT 'fallback-on-failure',
	`fallbackEnabled` int NOT NULL DEFAULT 1,
	`failureThreshold` int NOT NULL DEFAULT 3,
	`recoverySeconds` int NOT NULL DEFAULT 30,
	`groqWeight` int NOT NULL DEFAULT 60,
	`geminiWeight` int NOT NULL DEFAULT 40,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `routing_configs_id` PRIMARY KEY(`id`)
);
