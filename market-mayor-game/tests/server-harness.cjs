// Evaluate the UNMODIFIED production server in an isolated test VM.
// Only transport/listen are substituted; rules and event handlers are real.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function createHarness() {
  let connect;
  const sockets = new Map();
  const express = () => ({ use() {}, get() {} }); express.static = () => {};
  class Server { on(event, fn) { if (event === 'connection') connect = fn; } to(id) { return { emit: (event, data) => sockets.get(id)?.emit(event, data) }; } }
  const context = vm.createContext({
    require: name => name === 'express' ? express : name === 'http' ? { createServer: () => ({ listen() {} }) } : name === 'socket.io' ? { Server } : require(name),
    __dirname: path.resolve(__dirname, '..'), process: { env: {} }, console,
  });
  const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  vm.runInContext(source + '\n;globalThis.fixture = {rooms, CARDS, publicState, broadcast, resetRoomForGame, startActions, points};', context);
  let sequence = 0;
  function client(name = '후보') {
    const socket = { id: `socket-${++sequence}`, data: {}, handlers: {}, messages: [], state: null,
      on(event, fn) { (this.handlers[event] ||= []).push(fn); },
      emit(event, data) { const copy = JSON.parse(JSON.stringify(data)); this.messages.push({ event, data: copy }); if (event === 'state') this.state = copy; },
      send(event, data) { this.handlers[event].forEach(fn => fn(data)); }, join() {}, leave() {}
    };
    sockets.set(socket.id, socket); connect(socket); socket.name = name; return socket;
  }
  function room(maxPlayers = 6, count = 2) {
    const clients = Array.from({ length: count }, (_, i) => client(`후보 ${i + 1}`));
    clients[0].send('createRoom', { name: clients[0].name, maxPlayers });
    const code = clients[0].state.code;
    for (const socket of clients.slice(1)) socket.send('joinRoom', { code, name: socket.name });
    return { clients, room: context.fixture.rooms.get(code) };
  }
  return { ...context.fixture, client, room };
}
module.exports = { createHarness };
