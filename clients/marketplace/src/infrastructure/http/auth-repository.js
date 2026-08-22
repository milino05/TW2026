import { apiClient } from "./api-client.js";

export const authRepository = {
  me() {
    return apiClient.request("/auth/me");
  },
  login(username, password) {
    return apiClient.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  logout() {
    return apiClient.request("/auth/logout", { method: "POST" });
  },
};
