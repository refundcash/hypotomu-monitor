import crypto from "crypto";

/**
 * Validate API key from request headers
 */
export function validateApiKey(request: Request): boolean {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    return false;
  }

  // Get valid API keys from environment variable
  // Format: KEY1,KEY2,KEY3 or just a single key
  const validKeys = process.env.API_KEYS?.split(",").map(k => k.trim()) || [];

  return validKeys.includes(apiKey);
}

/**
 * Generate a new API key
 */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Get API key from request headers
 */
export function getApiKey(request: Request): string | null {
  return request.headers.get("x-api-key");
}

/**
 * Create an unauthorized response
 */
export function unauthorizedResponse() {
  return new Response(
    JSON.stringify({
      error: "Unauthorized",
      message: "Valid API key required. Include 'x-api-key' header.",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}
