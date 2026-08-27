const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }

const authRoutes = read("routes/auth.routes.js");
const authService = read("services/auth.service.js");
const authDesign = read("docs/authentication-design.md");
const marketplaceRepository = read("clients/marketplace/src/infrastructure/http/auth-repository.js");
const marketplaceShell = read("clients/marketplace/src/ui/app-shell.js");
const navigatorRepository = read("clients/navigator/src/infrastructure/http/authRepository.ts");
const navigatorLogin = read("clients/navigator/src/ui/LoginView.vue");

test("registration riusa il boundary auth condiviso senza autoassegnare ruoli", () => {
  assert.match(authRoutes, /router\.post\("\/auth\/register", register\)/);
  assert.match(authService, /async function registerUser\(\{ username, password \}\)/);
  assert.match(authService, /new User\(\{\s*username: normalizedUsername,\s*passwordHash:/s);
  assert.doesNotMatch(authService, /registerUser[\s\S]*?(membership|roleAssignments|owner)/i);
  assert.match(authDesign, /registrazione libera crea utenti senza membership Organization/);
});

test("Marketplace mantiene il login come default ed espone la registrazione", () => {
  assert.match(marketplaceRepository, /register\(username, password\)/);
  assert.match(marketplaceRepository, /"\/auth\/register"/);
  assert.match(marketplaceShell, /authMode = "login"/);
  assert.match(marketplaceShell, /authRepository\.register\(username, password\)/);
  assert.match(marketplaceShell, /data-auth-mode/);
  assert.match(marketplaceShell, /minlength="8" maxlength="128"/);
  assert.match(marketplaceShell, /Non hai ancora un account\?/);
});

test("Navigator mantiene il login come default ed espone la registrazione", () => {
  assert.match(navigatorRepository, /register\(username: string, password: string\)/);
  assert.match(navigatorRepository, /"\/auth\/register"/);
  assert.match(navigatorLogin, /ref<"login" \| "register">\("login"\)/);
  assert.match(navigatorLogin, /authRepository\.register\(username\.value, password\.value\)/);
  assert.match(navigatorLogin, /@click="switchMode"/);
  assert.match(navigatorLogin, /minlength="8"/);
  assert.match(navigatorLogin, /Non hai ancora un account\?/);
});

test("file JavaScript modificati passano il syntax gate", () => {
  for (const relativePath of [
    "clients/marketplace/src/infrastructure/http/auth-repository.js",
    "clients/marketplace/src/ui/app-shell.js",
  ]) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relativePath}: ${result.stderr || result.stdout}`);
  }
});
