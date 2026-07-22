# Terminal Output Duplication Fix - Progress

## Fix 1: terminalManager.js - sendTerminalInput()
- [x] Remove synthetic terminal_output event for input text (the shell echo naturally captured by background reader is sufficient)

## Fix 2: terminalManager.js - checkTerminalOutput()
- [x] Track last returned position/index to return only new output since last check

## Fix 3: ChatSpace.js - updateTerminalCardResult()
- [x] Don't clear existing body content if already populated by streaming terminal_output events
