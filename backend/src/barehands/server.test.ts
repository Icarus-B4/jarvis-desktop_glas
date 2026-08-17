import { createBarehandsServer } from "./server";

const server = createBarehandsServer({
  root: ".",
  port: 8795,
});

const response = await server.handleRequest(new Request("http://127.0.0.1:8795/barehands/health"));
const text = await response.text();
console.log("health:", text);

const configResponse = await server.handleRequest(new Request("http://127.0.0.1:8795/barehands/config"));
const configText = await configResponse.text();
console.log("config:", configText);

const orbResponse = await server.handleRequest(new Request("http://127.0.0.1:8795/barehands/orb"));
const orbText = await orbResponse.text();
console.log("orb:", orbText);

const cmdResponse = await server.handleRequest(new Request("http://127.0.0.1:8795/barehands/cmd", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ a: "add_card", title: "TEST" }),
}));
console.log("cmd status:", cmdResponse.status);

const stateResponse = await server.handleRequest(new Request("http://127.0.0.1:8795/barehands/state"));
console.log("state:", await stateResponse.text());

const postStateResponse = await server.handleRequest(new Request("http://127.0.0.1:8795/barehands/state", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify([{ a: "add_card", title: "HELLO" }]),
}));
console.log("post state:", await postStateResponse.text());

const getStateResponse = await server.handleRequest(new Request("http://127.0.0.1:8795/barehands/state"));
console.log("get state:", await getStateResponse.text());

const boardStateResponse = await server.handleRequest(new Request("http://127.0.0.1:8795/barehands/board-state"));
console.log("board state:", await boardStateResponse.text());

console.log("All barehands server routes passed");
