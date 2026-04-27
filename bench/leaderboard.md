# MCP Server Token Leaderboard

_Generated: 2026-04-27T10:09:21.696Z · gateway v0.2.0_

**6** of 6 benchmarked servers started successfully, spending **4,657** tokens total on tool schemas.

> Measured by connecting each server and running `list_tools`, then summing estimated tokens across every advertised tool (name + description + JSON Schema). Numbers are directional — an MCP client that picks up 5 of these is spending this much just on boilerplate before you type a message.

## Top 10 leanest servers

| # | Server | Tools | Tokens | Category |
| --: | :-- | --: | --: | :-- |
| 1 | [fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) | 0 | 0 | web |
| 2 | [git](https://github.com/modelcontextprotocol/servers/tree/main/src/git) | 0 | 0 | vcs |
| 3 | [time](https://github.com/modelcontextprotocol/servers/tree/main/src/time) | 0 | 0 | utilities |
| 4 | [sequentialthinking](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) | 1 | 1,149 | reasoning |
| 5 | [memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | 9 | 1,211 | memory |
| 6 | [filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) | 14 | 2,297 | filesystem |

## Top 10 heaviest servers

| # | Server | Tools | Tokens | Category |
| --: | :-- | --: | --: | :-- |
| 1 | [filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) | 14 | 2,297 | filesystem |
| 2 | [memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | 9 | 1,211 | memory |
| 3 | [sequentialthinking](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) | 1 | 1,149 | reasoning |
| 4 | [fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) | 0 | 0 | web |
| 5 | [git](https://github.com/modelcontextprotocol/servers/tree/main/src/git) | 0 | 0 | vcs |
| 6 | [time](https://github.com/modelcontextprotocol/servers/tree/main/src/time) | 0 | 0 | utilities |

Want your server included? Open a PR against [bench/servers.json](../bench/servers.json).
