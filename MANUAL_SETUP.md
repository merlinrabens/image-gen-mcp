# Manual Setup Checklist for Provider Optimization

This checklist covers the manual steps you need to take to complete the provider optimization implementation.

## ✅ Already Implemented (Automated)

The following have been automatically implemented in the feature branch:

- ✅ Recraft V3 provider added
- ✅ Ideogram upgraded from V2 to V3
- ✅ Provider selector updated with new keywords
- ✅ Fallback chain optimized
- ✅ TypeScript types updated
- ✅ Configuration updated

## 🔧 Manual Steps Required

### 1. Register for New API Keys

You'll need API keys for the new providers:

#### Recraft V3 (CRITICAL - #1 Provider)
**Why:** #1 globally ranked, unique vector generation, perfect text rendering

1. Go to: https://www.recraft.ai/
2. Sign up for an account
3. Navigate to API settings
4. Generate an API key
5. Add to your `.claude.json` or environment:
   ```json
   "RECRAFT_API_KEY": "your_key_here"
   ```

**Pricing:** $0.04/image (same as OpenAI)
**Free Trial:** Check their website for current offerings

### 2. Update Existing API Keys (If Needed)

#### Ideogram V3
Your existing `IDEOGRAM_API_KEY` should work with V3 automatically. No action needed unless you see errors.

**To verify:** The implementation defaults to V3 model but falls back gracefully to V2 if V3 is not available yet in your region.

### 3. Optional: Future Providers (Not Yet Implemented)

The following were researched but require additional implementation work:

#### FAL FLUX Speed Variant
- **Status:** Requires FAL account (you already have `FAL_API_KEY`)
- **Action:** No changes needed - your existing FAL key will work when we add FLUX support
- **Future Work:** Implement in Phase 1.5 if desired

#### Qwen Image Edit
- **Status:** Research phase - API availability unclear
- **Action:** Monitor for public API release
- **Alternative:** Current editing providers (OpenAI, Stability, BFL, Gemini) cover most use cases

## 📝 Configuration Update

Add the new environment variable to your `.claude.json`:

### For Claude Code (~/.claude.json)

```json
{
  "mcpServers": {
    "image-gen-mcp-server": {
      "command": "npx",
      "args": ["-y", "@merlinrabens/image-gen-mcp-server@latest"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "STABILITY_API_KEY": "sk-...",
        "REPLICATE_API_TOKEN": "r8_...",
        "GEMINI_API_KEY": "AIza...",
        "LEONARDO_API_KEY": "...",
        "IDEOGRAM_API_KEY": "...",
        "BFL_API_KEY": "...",
        "FAL_API_KEY": "...",
        "CLIPDROP_API_KEY": "...",
        "RECRAFT_API_KEY": "...",  // ← ADD THIS
        "DEFAULT_PROVIDER": "auto",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### For Claude Desktop (macOS)

Same structure, but file location:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## 🧪 Testing the New Features

After adding your API keys:

### 1. Restart Your MCP Client
Close and reopen Claude Desktop or reload Claude Code.

### 2. Test Recraft V3

Try these prompts to test Recraft's unique capabilities:

**Vector Generation:**
```
Generate a vector logo with the text "TechCo 2025" - modern, minimal, scalable design
```

**Perfect Text Rendering:**
```
Create a poster with headline "SUMMER FESTIVAL" and text "June 15-17, 2025" in bold typography
```

**Graphic Design:**
```
Design product packaging for coffee brand with product name and description text
```

### 3. Test Ideogram V3

Try prompts with complex text:

```
Create a vintage poster with text "GRAND OPENING" and "Join us for the celebration!" retro style
```

### 4. Verify Provider Selection

Test auto-selection is working:

```
Generate a logo with text "StartupName" (should auto-select Recraft or Ideogram)
```

```
Generate ultra-quality product photo of a watch (should auto-select BFL)
```

## ⚠️ Troubleshooting

### "Provider RECRAFT not configured"

**Solution:** Make sure you've:
1. Registered for a Recraft account
2. Generated an API key
3. Added `RECRAFT_API_KEY` to your config
4. Restarted your MCP client

### "Model V_3 not found" (Ideogram)

**Solution:** Ideogram V3 might not be available in all regions yet. The implementation will automatically fall back to V_2. No action needed.

### Recraft Returns "Invalid API Key"

**Solution:**
1. Verify your API key is correct (copy-paste to avoid typos)
2. Check if your key has sufficient credits/quota
3. Verify your account is fully activated

## 📊 Cost Estimates

With the new providers, your costs should actually decrease with smart routing:

| Provider | Cost per Image | Use Case |
|----------|---------------|----------|
| **Recraft V3** ⭐ NEW | $0.04 | Vector/text-heavy/design |
| BFL FLUX | $0.04 | High-quality photorealism |
| Ideogram V3 | $0.08 | Text rendering |
| OpenAI | $0.04 | Versatile fallback |
| Stability | $0.065 | Photorealism |
| Others | Varies | Specialized |

**Expected Savings:** ~30-40% with intelligent routing (using cheaper providers when appropriate)

## 🎯 Next Steps

After completing manual setup:

1. **Test all providers** with the commands above
2. **Monitor costs** for a few days to see savings
3. **Report any issues** to the GitHub repo
4. **Enjoy** vector generation and perfect text rendering! 🎉

## 📚 Additional Resources

- [Recraft V3 Documentation](https://www.recraft.ai/docs/api)
- [Recraft V3 Announcement](https://www.recraft.ai/blog/recraft-introduces-a-revolutionary-ai-model-that-thinks-in-design-language)
- [Ideogram 3.0 Features](https://ideogram.ai/features/3.0)
- [Provider Optimization Report](./PROVIDER_OPTIMIZATION_REPORT.md) - Full research and analysis

## ❓ Getting Help

If you encounter issues:

1. Check the [GitHub Issues](https://github.com/merlinrabens/image-gen-mcp-server/issues/17)
2. Review the [troubleshooting section](#️-troubleshooting) above
3. Check provider-specific documentation
4. Open a new GitHub issue with details

---

**Estimated Time:** 10-15 minutes for Recraft signup and config update

**Priority:** HIGH - Recraft V3 adds unique capabilities (vector generation) that no other provider offers
