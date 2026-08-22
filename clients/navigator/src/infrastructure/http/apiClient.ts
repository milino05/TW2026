export class ApiClient {
  constructor(private readonly baseUrl = "/api") {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return body as T;
  }
}

export const apiClient = new ApiClient();
