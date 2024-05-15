import {pollThemeEditorChanges} from './theme-environment/theme-polling.js'
import {reconcileThemeFiles} from './theme-environment/theme-reconciliation.js'
import {outputDebug} from '@shopify/cli-kit/node/output'
import {AdminSession} from '@shopify/cli-kit/node/session'
import {Checksum, Theme, ThemeFileSystem} from '@shopify/cli-kit/node/themes/types'
import {fetchChecksums} from '@shopify/cli-kit/node/themes/api'

export const LOCAL_STRATEGY = 'local'
export const REMOTE_STRATEGY = 'remote'

export async function initializeThemeEditorSync(
  targetTheme: Theme,
  session: AdminSession,
  remoteChecksums: Checksum[],
  localThemeFileSystem: ThemeFileSystem,
) {
  outputDebug('Initiating theme asset reconciliation process')
  await reconcileThemeFiles(targetTheme, session, remoteChecksums, localThemeFileSystem)

  const updatedRemoteChecksums = await fetchChecksums(targetTheme.id, session)

  pollThemeEditorChanges(targetTheme, session, updatedRemoteChecksums, localThemeFileSystem)
}
