import {uploadTheme} from './theme-uploader.js'
import {initializeThemeEditorSync} from './asset-file-syncer.js'
import {DevServerContext} from './theme-environment/types.js'
import {Theme} from '@shopify/cli-kit/node/themes/types'

export async function startDevServer(theme: Theme, ctx: DevServerContext, onReady: () => void) {
  await ensureThemeEnvironmentSetup(theme, ctx)

  onReady()
}

async function ensureThemeEnvironmentSetup(theme: Theme, ctx: DevServerContext) {
  if (ctx.themeEditorSync) {
    await initializeThemeEditorSync(theme, ctx.session, ctx.remoteChecksums, ctx.localThemeFileSystem)
  } else {
    await uploadTheme(theme, ctx.session, ctx.remoteChecksums, ctx.localThemeFileSystem, {})
  }
}
