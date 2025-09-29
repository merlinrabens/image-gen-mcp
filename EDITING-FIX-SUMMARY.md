# Image Editing Session-Breaking Bug Fix

## The Problem

### Symptoms
- Using `image.edit` would cause Claude API to fail with "Could not process image" error
- This error would **kill the entire Claude session**, forcing a restart
- Happened consistently with OpenAI and Ideogram providers
- Generated "continue" option was broken (session was dead)

### Root Cause
```typescript
// BEFORE (src/index.ts:309)
case 'image.edit': {
  const result = await provider.edit(input);

  // ❌ PROBLEM: Returning 5-10MB base64 images in JSON
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)  // Contains huge base64 data URLs
    }]
  };
}
```

The `image.edit` endpoint was returning large base64-encoded images (5-10MB) directly in the JSON response. When this went through Claude's API, it would fail to process the image and kill the session.

### Why It Only Affected Editing

The `image.generate` endpoint was **already** saving files to disk:
```typescript
// image.generate was doing it right
const savedImages = await Promise.all(result.images.map(async (img, idx) => {
  const buffer = Buffer.from(base64Data, 'base64');
  const filepath = path.join(os.tmpdir(), filename);
  await fs.writeFile(filepath, buffer);
  return { path: filepath, format: img.format, size: buffer.length };
}));
```

But `image.edit` was returning the base64 data directly, not saving to disk.

## The Solution

### Code Changes

**File:** `src/index.ts:309-339`

```typescript
// AFTER - Now saves to disk like generate does
case 'image.edit': {
  const result = await provider.edit(input);

  // ✅ SOLUTION: Save to disk, return file paths
  const savedImages = await Promise.all(result.images.map(async (img, idx) => {
    const base64Data = img.dataUrl.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    const hash = createHash('md5').update(buffer).digest('hex');
    const filename = `${TEMP_FILE_PREFIX}${result.provider.toLowerCase()}-edit-${hash}-${Date.now()}-${idx}.${img.format || 'png'}`;
    const filepath = path.join(os.tmpdir(), filename);
    await fs.writeFile(filepath, buffer);
    return {
      path: filepath,
      format: img.format,
      size: buffer.length
    };
  }));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        images: savedImages,  // File paths instead of base64
        provider: result.provider,
        model: result.model,
        warnings: result.warnings,
        note: 'Images saved to disk. Files contain the edited results.'
      }, null, 2)
    }]
  };
}
```

### Why This Works

1. **No base64 in API responses** - Images are saved to disk first
2. **Claude never sees the image data** - Only receives file paths
3. **No API processing limits** - File paths are tiny strings
4. **Original quality preserved** - No compression needed
5. **Works for any size** - 100KB or 100MB, doesn't matter

### File Naming Convention

```
/tmp/mcp-image-{pid}-{session}-{provider}-edit-{hash}-{timestamp}-{index}.{format}

Example:
/tmp/mcp-image-12345-a1b2c3d4-ideogram-edit-9f8e7d6c-1735612800000-0.png
```

## Test Results

### Before Fix
| Provider | Status | Issue |
|----------|--------|-------|
| OpenAI | ❌ Session crash | 3.0MB base64 killed Claude API |
| Ideogram | ❌ 0KB corrupt | Session died before saving |
| Stability | ✅ Working | Already had workaround |
| Gemini | ✅ Working | Smaller files, got lucky |
| BFL | ✅ Working | Smaller files, got lucky |

### After Fix
| Provider | Status | File Size | Time |
|----------|--------|-----------|------|
| OpenAI | ✅ Fixed | 3.0MB saved to disk | 16.3s |
| Ideogram | ✅ Fixed | Proper file, not 0KB | 10.6s |
| Stability | ✅ Working | 1.7MB saved to disk | 14.2s |
| Gemini | ✅ Working | 1.6MB saved to disk | 7.9s |
| BFL | ✅ Working | 930KB saved to disk | 7.9s |

**Success Rate: 100% (5/5) - No more session crashes! 🎉**

## Technical Benefits

### 1. Consistency
- `image.generate` and `image.edit` now work identically
- Same file-based response pattern
- Predictable behavior

### 2. Performance
- No base64 encoding overhead in API responses
- Smaller response payloads (file paths vs. megabytes)
- Faster JSON parsing

### 3. Reliability
- No more session-killing errors
- Works with any image size
- No artificial limits needed

### 4. Quality
- No compression required
- Original format preserved
- Lossless workflow

### 5. Cleanup
- Automatic cleanup of files >1 hour old
- Process-specific temp file prefixes
- No disk space leaks

## Files Changed

```
src/index.ts          - Updated image.edit endpoint to save files
src/providers/base.ts - Reverted compression code (not needed)
SHOWCASE.md           - Updated with fix details and results
EDITING-FIX-SUMMARY.md - This document
```

## Lessons Learned

### What We Almost Did Wrong

1. **Initial instinct: Compress images**
   - Would have degraded quality (PNG→JPEG 85%)
   - Still sends data through Claude API
   - Doesn't fully solve the problem
   - More CPU overhead

2. **User suggestion: Save to disk**
   - Simple solution
   - Preserves quality
   - Completely avoids API issue
   - Already proven pattern (generate was doing it)

### The Right Approach

**User was right!** Sometimes the simple solution is the best:
- Don't overthink it
- Match existing patterns
- Preserve quality
- Fix the root cause, not the symptom

## Usage After Fix

### Before (would crash)
```bash
# This would kill your session
npx @modelcontextprotocol/inspector image.edit \
  --baseImage "data:image/png;base64,..." \
  --prompt "Change background to blue"
# ❌ Error: Could not process image
# Session dead, need to restart Claude
```

### After (works perfectly)
```bash
# This now works reliably
npx @modelcontextprotocol/inspector image.edit \
  --baseImage "data:image/png;base64,..." \
  --prompt "Change background to blue"
# ✅ Returns: { images: [{ path: "/tmp/mcp-image-...", size: 3145728 }] }
# Session stays alive, can continue working
```

## Conclusion

This was a **critical production bug** that made image editing unusable. The fix:
- ✅ Simple (just save to disk)
- ✅ Effective (100% success rate)
- ✅ Consistent (matches generate behavior)
- ✅ Quality-preserving (no compression)
- ✅ Scalable (any image size)

**Status:** 🎉 FIXED - All editing operations stable

**Updated:** September 30, 2025