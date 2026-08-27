import { apiClient } from "./api-client.js";

export const authRepository = {
  me() {
    return apiClient.request("/auth/me");
  },
  register(username, password) {
    return apiClient.request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
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
