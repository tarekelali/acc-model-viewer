# Lovable Update Guide

## Overview
This guide explains how to update and deploy changes to your Lovable project when working with external collaborators (like Claude) who make changes via Git.

## Understanding Lovable's Deployment Model

### Frontend Changes
- **Require manual deployment**: UI changes, styling, client-side code
- **Deployment method**: Click "Update" button in the Publish dialog (top-right or bottom-right depending on device)
- **Location**: Desktop = top-right, Mobile = bottom-right in Preview mode

### Backend Changes  
- **Deploy automatically**: Edge functions, database migrations, server-side logic
- **No action needed**: Changes deploy immediately when synced to the project

## Workflow for External Updates

### Step 1: Sync Changes from Git
When a collaborator (like Claude) pushes changes to a Git branch:

1. **Switch Branch in Lovable**:
   - Look for the branch switcher in Lovable's UI
   - Select the branch with the updates (e.g., `claude/autodesk-viewer-webapp-011CUjAAn8naDYwPfvquMKzR`)
   - Lovable will automatically pull the latest changes

2. **Alternative - Manual Git Pull** (if needed):
   ```bash
   git pull origin <branch-name>
   ```

### Step 2: Verify Changes
Check that updated files are present:
- Review changed files in Dev Mode
- Look for specific code markers (e.g., build version constants, new logging statements)

### Step 3: Deploy Frontend Changes
1. Click the **Publish** button in Lovable
2. In the publish dialog, click **Update** to deploy frontend changes
3. Wait for deployment to complete
4. Verify changes are live in production URL

### Step 4: Verify Backend Changes
- Edge functions deploy automatically when code is synced
- Check edge function logs to confirm deployment:
  - Navigate to Cloud → Edge Functions in Lovable
  - View logs for recent deployment events

## Common Scenarios

### Scenario: Claude Added Enhanced Logging
**Files Changed**: `src/pages/Viewer.tsx`  
**Type**: Frontend  
**Action Required**: Deploy frontend by clicking Update in Publish dialog

### Scenario: Claude Fixed Edge Function Parameters  
**Files Changed**: `supabase/functions/revit-modify/index.ts`  
**Type**: Backend  
**Action Required**: None - auto-deployed when synced

### Scenario: Claude Added New Documentation
**Files Changed**: `docs/` or `.md` files  
**Type**: Documentation  
**Action Required**: None - informational only

## Troubleshooting

### Changes Not Appearing After Update
1. **Hard refresh browser**: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
2. **Clear browser cache**: May be serving old JavaScript bundle
3. **Check build version**: Look for version constant in console logs
4. **Verify correct branch**: Ensure you're on the branch with changes

### Edge Function Not Working
1. **Check deployment logs**: Cloud → Edge Functions → View logs
2. **Verify function name**: Ensure edge function file path matches call
3. **Check secrets**: Verify required environment variables are configured
4. **Review function logs**: Look for runtime errors in edge function logs

### Build Failures
1. **Check console errors**: Look for TypeScript or build errors
2. **Verify dependencies**: Ensure all packages are installed
3. **Review error logs**: Check for specific error messages in build output

## Best Practices

### Version Tracking
- Add build version constants to frontend code:
  ```typescript
  const BUILD_VERSION = "v2.0.0-feature-name";
  console.log(`🚀 App Build: ${BUILD_VERSION}`);
  ```

### Communication with External Collaborators
- **Before deployment**: Review all changes in pull request or branch
- **After deployment**: Test functionality thoroughly
- **Provide feedback**: Share deployment results and any issues encountered

### Testing
1. **Test locally first**: Use Lovable's preview before deploying
2. **Verify each change**: Check that specific features work as expected  
3. **Monitor logs**: Watch console and edge function logs during testing
4. **Test edge cases**: Try error scenarios to verify error handling

## Git Integration

### Enabling Git Sync
1. Click the GitHub button in Lovable (top-right)
2. Connect your GitHub account
3. Link to existing repository or create new one
4. Lovable will sync changes bidirectionally

### Branch Management
- **Main/master**: Production-ready code
- **Feature branches**: Active development (e.g., `claude/feature-name`)
- **Merge workflow**: Review → Test → Merge → Deploy

### Conflict Resolution
If conflicts occur during sync:
1. Resolve conflicts in your preferred Git tool
2. Push resolved changes
3. Lovable will detect and sync updated code

## Lovable-Specific Features

### Visual Edits
- For simple visual changes (text, colors, fonts)
- Access via Edit button in Lovable UI
- **Free for direct edits** (no credit usage)
- Use this for quick tweaks instead of AI prompts

### Dev Mode
- Toggle in top-left of Lovable editor
- View and manually edit code
- Must be enabled in Account Settings → Labs → Enable Code Editing

### Backend Access
- View database, auth, storage via "View Backend" in Lovable
- No direct Supabase dashboard access needed
- Lovable provides UI for common backend tasks

## Support Resources

- **Lovable Docs**: https://docs.lovable.dev/
- **Troubleshooting Guide**: https://docs.lovable.dev/tips-tricks/troubleshooting
- **Discord Community**: https://discord.com/channels/1119885301872070706/1280461670979993613
- **YouTube Tutorials**: https://www.youtube.com/watch?v=9KHLTZaJcR8&list=PLbVHz4urQBZkJiAWdG8HWoJTdgEysigIO

## Quick Reference

| Change Type | Auto-Deploy? | Action Required |
|-------------|--------------|-----------------|
| Frontend (React components, UI) | No | Click Update in Publish dialog |
| Backend (Edge functions) | Yes | None - automatic |
| Database migrations | Yes | Approve migration prompt |
| Documentation | N/A | None - informational |
| Configuration files | Depends | Follow Lovable prompts |

---

**Last Updated**: 2024-11-24  
**Version**: 1.0.0
