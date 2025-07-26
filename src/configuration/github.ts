// each message contains 200 active repositories
export const ACTIVE_REPOSITORIES_PER_MESSAGE = 200;

// ~80k repositories per hour batch (80000 / 200 = 400 messages)

// each lambda invocation handles 10k repos (10000 / 200 = 50 messages)
const targetRepositoriesPerLambda = 10000;
export const REPOSITORIES_TO_PROCESS_PER_LAMBDA = targetRepositoriesPerLambda;
export const MESSAGES_TO_PROCESS_PER_LAMBDA = Math.floor(targetRepositoriesPerLambda / ACTIVE_REPOSITORIES_PER_MESSAGE);

// Process messages concurrently up to the lambda's batch size
export const MESSAGES_TO_PROCESS_CONCURRENTLY = MESSAGES_TO_PROCESS_PER_LAMBDA;

const p99BytesPerVirtualThread = 5000;
const maxConcurrencyBytesUsed = p99BytesPerVirtualThread * targetRepositoriesPerLambda;

const maxConcurrencyMbUsed = maxConcurrencyBytesUsed / 1024 / 1024 + MESSAGES_TO_PROCESS_CONCURRENTLY;
// <=50% of the lambda's memory is used for the concurrency
export const LAMBDA_ALLOCATED_MEMORY = Math.ceil(maxConcurrencyMbUsed / 0.5);
