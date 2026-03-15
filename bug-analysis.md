# DropTransfer Bug Analysis

## Critical Issues Found

### 1. Service Worker Reload Loop (index.html:103-145)
**Problem**: Multiple overlapping reload mechanisms can cause infinite reload loops.
- `controllerchange` event triggers reload
- `CACHE_CLEARED` message triggers reload  
- Hard reload detection triggers cache clearing
- The `refreshing` flag is local to IIFE but cooldown is in sessionStorage - timing issues can cause loops

**Fix**: Consolidate reload logic and add stronger guards.

### 2. Race Condition in Chunk Sending (index.html:640-750)
**Problem**: The `sendNextChunk` function captures `chunkIndex` from outer scope and modifies it asynchronously. When backpressure causes a wait, the shared `chunkIndex` can be modified by concurrent operations, causing:
- Duplicate chunks sent
- Missing chunks
- Out-of-order delivery

**Fix**: Use a proper async queue or capture index per iteration.

### 3. ArrayBuffer Serialization Issue (index.html:694)
**Problem**: PeerJS with `serialization: 'binary'` has known issues with ArrayBuffer transfer. The chunk data may not be properly serialized.

**Fix**: Convert ArrayBuffer to Uint8Array before sending.

### 4. Data Channel Buffer Check Crash (index.html:714)
**Problem**: `conn.dataChannel.bufferedAmount` assumes dataChannel exists, but it can be `undefined` during connection establishment or after close.

**Fix**: Add null check before accessing bufferedAmount.

### 5. Connection Timeout Memory Leak (index.html:928, 947)
**Problem**: `connectionTimeout` is set but not cleared in all error paths. If peer connection fails before `conn.on('open')`, the timeout continues and may trigger after cleanup.

**Fix**: Clear timeout in all error handlers.

### 6. Variable Shadowing Bug in Chunk Retry (index.html:732-756)
**Problem**: In the retry loop, `fileIndex` parameter shadows the outer `fileIndex` variable, causing incorrect file lookup.

```javascript
for (const [chunkKey, chunkInfo] of pendingAcks) {
    const { index, fileIndex: fi } = chunkInfo;  // fi shadows fileIndex
    const fileObj = filesToSend[fi];  // Uses wrong index!
```

**Fix**: Rename variable to avoid shadowing.

### 7. Missing Error Handler for dirReader (index.html:402-412)
**Problem**: `dirReader.readEntries` doesn't have an error handler, causing silent failures when directory access is denied.

### 8. WebTorrent DOM Element Check (index.html:998-1000)
**Problem**: `document.getElementById('sendProgressFill')` could be null if reset during upload.

### 9. PeerJS Connection Without Error Handling (index.html:573-619)
**Problem**: `handleConnection` sets up handlers but doesn't guard against closed connections during async operations.

## Fixes Applied

1. **Service Worker**: Added debounced reload with proper state tracking
2. **Chunk sending**: Fixed race condition with proper async iteration
3. **ArrayBuffer**: Convert to Uint8Array for reliable serialization
4. **Data channel**: Added null checks
5. **Timeouts**: Proper cleanup in all paths
6. **Variable shadowing**: Renamed variables
7. **Error handlers**: Added throughout
