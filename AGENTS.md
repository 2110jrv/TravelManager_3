<!-- CODEX_EXECUTION_PROTOCOL_START -->
# CODEX EXECUTION PROTOCOL
## Role
Codex is an implementation agent. ChatGPT is the architect.
Execute the requested task exactly as specified. Do not redesign the solution, expand the scope, or provide user-oriented explanations unless explicitly requested.
## Token and context efficiency
* Read only files required for the current task.
* Do not scan the entire repository unless explicitly instructed.
* Do not reread large documentation files when the needed rules are already supplied in the task.
* Prefer targeted searches over broad exploration.
* Do not inspect generated files, build outputs, dependencies, or unrelated directories.
* Do not repeat the task or narrate routine actions.
* Do not produce tutorials, summaries for humans, or long explanations.
* Do not create additional documentation unless explicitly requested.
* Do not use subagents or parallel exploration unless explicitly authorized.
* Do not make speculative improvements outside the requested scope.
* Use existing project conventions and utilities whenever available.
## Execution
* Make the smallest complete change that satisfies the task.
* Preserve unrelated behavior.
* Do not modify files outside the allowed scope.
* Run only the tests or checks relevant to the affected code.
* If a command can be safely delegated to PowerShell without requiring code reasoning, identify that command in the report instead of consuming additional exploration.
* Do not repeatedly rerun unchanged commands after a conclusive result.
* Do not ask questions when a reasonable implementation is directly determined by the task and repository.
* Stop when the acceptance criteria are satisfied.
## Final response
Return only:
DONE
CHATGPT_REPORT
status: PASS | PARTIAL | BLOCKED
changed:
* path: concise technical description
  validation:
* command: result
  issues:
* none | concise blocking issue
  next:
* none | exact recommended next action
  END_REPORT
Keep the complete final response under 250 words unless a failure requires essential diagnostic evidence.
## Project path lock
* The authorized project root is exactly: `C:\Codex\TravelManager_3`.
* Before reading, modifying, testing, or running commands, verify the active working directory.
* If the active directory is not `C:\Codex\TravelManager_3`, stop immediately.
* Do not read or modify files outside the authorized project root.
* Do not infer the project root from the editor workspace or current terminal directory.
* Every task message must include the absolute project path near the top.
* Every report must confirm the project path used.
## Message numbering
* Every ChatGPT task includes a message number such as `TM3-023`.
* Codex must respond using the next sequential number.
* Example: task `TM3-023` → response `TM3-024`.
* The response must include:
  `RESPONSE_TO: TM3-023`
  `MESSAGE: TM3-024`
* Never omit or reuse a message number.
<!-- CODEX_EXECUTION_PROTOCOL_END -->

## Remote Cloud checkout exception (TM3-ACCESO-REMOTO-021)
The Windows project path lock remains mandatory on this PC. In a Linux Codex Cloud environment only, use the Git root of a checkout whose origin is exactly https://github.com/2110jrv/TravelManager_3.git (or its SSH equivalent); verify origin and current branch before work. Start from codex/v2-cloud-stable (which includes codex/v2-remote-022), create a codex/* task branch, and run npm ci, npm run build:v2, npm run test:v2 and npm run test:v2:remote-content. Never push or merge main, change production, copy private attachments, or use the local .av2-private directory as a cloud credential source. Staging publishing requires a reviewed source SHA and the staging-only workflow.
