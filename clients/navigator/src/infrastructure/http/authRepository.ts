import { apiClient } from "./apiClient";

export interface AuthUser {
  _id: string;
  username: string;
  status: "active" | "disabled";
}

interface AuthResponse {
  user: AuthUser;
  sessionExpiresAt?: string;
}

export const authRepository = {
  me() {
    return apiClient.request<AuthResponse>("/auth/me");
  },
  register(username: string, password: string) {
    return apiClient.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  login(username: string, password: string) {
    return apiClient.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  async logout() {
    await apiClient.request<unknown>("/auth/logout", { method: "POST" });
  },
};
