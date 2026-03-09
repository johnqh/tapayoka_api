// Test setup file
// Configure test environment variables before tests run
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/tapayoka_test";
process.env.SERVER_ETH_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
