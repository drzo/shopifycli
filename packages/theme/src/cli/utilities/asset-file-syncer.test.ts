import {fakeThemeFileSystem} from './theme-fs/theme-fs-mock-factory.js'
import {reconcileThemeFiles} from './theme-environment/theme-reconciliation.js'
import {initializeThemeEditorSync} from './asset-file-syncer.js'
import {pollThemeEditorChanges} from './theme-environment/theme-polling.js'
import {fetchChecksums} from '@shopify/cli-kit/node/themes/api'
import {buildTheme} from '@shopify/cli-kit/node/themes/factories'
import {ThemeAsset} from '@shopify/cli-kit/node/themes/types'
import {DEVELOPMENT_THEME_ROLE} from '@shopify/cli-kit/node/themes/utils'
import {describe, expect, test, vi} from 'vitest'

vi.mock('@shopify/cli-kit/node/themes/api')
vi.mock('./theme-environment/theme-reconciliation.js')
vi.mock('./theme-environment/theme-polling.js')

describe('initializeThemeEditorSync', async () => {
  const developmentTheme = buildTheme({id: 1, name: 'Theme', role: DEVELOPMENT_THEME_ROLE})!
  const adminSession = {token: '', storeFqdn: ''}
  const files = new Map<string, ThemeAsset>([])
  const defaultThemeFileSystem = fakeThemeFileSystem('tmp', files)

  test('should call pollThemeEditorChanges with updated checksums if the remote theme was been updated during reconciliation', async () => {
    // Given
    const initialRemoteChecksums = [{checksum: '1', key: 'templates/asset.json'}]
    vi.mocked(reconcileThemeFiles).mockResolvedValue(undefined)
    vi.mocked(fetchChecksums).mockResolvedValue([{checksum: '2', key: 'templates/asset.json'}])

    // When
    await initializeThemeEditorSync(developmentTheme, adminSession, initialRemoteChecksums, defaultThemeFileSystem)

    // Then
    expect(pollThemeEditorChanges).toHaveBeenCalledWith(
      developmentTheme,
      adminSession,
      [{checksum: '2', key: 'templates/asset.json'}],
      defaultThemeFileSystem,
    )
  })
})
