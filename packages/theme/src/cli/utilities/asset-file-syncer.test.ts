import {LOCAL_STRATEGY, REMOTE_STRATEGY, initializeThemeEditorSync, pollRemoteChanges} from './asset-file-syncer.js'
import {fakeThemeFileSystem} from './theme-fs/theme-fs-mock-factory.js'
import {readThemeFilesFromDisk} from './theme-fs.js'
import {deleteThemeAsset, fetchChecksums, fetchThemeAsset} from '@shopify/cli-kit/node/themes/api'
import {buildTheme} from '@shopify/cli-kit/node/themes/factories'
import {Checksum, ThemeAsset, ThemeFileSystem} from '@shopify/cli-kit/node/themes/types'
import {DEVELOPMENT_THEME_ROLE} from '@shopify/cli-kit/node/themes/utils'
import {renderSelectPrompt} from '@shopify/cli-kit/node/ui'
import {describe, expect, test, vi} from 'vitest'
import {AbortError} from '@shopify/cli-kit/node/error'

vi.mock('@shopify/cli-kit/node/ui')
vi.mock('@shopify/cli-kit/node/themes/api')
vi.mock('./theme-fs.js')
vi.mock('./theme-downloader.js')
vi.mock('./theme-uploader.js')

describe('initializeThemeEditorSync', () => {
  const developmentTheme = buildTheme({id: 1, name: 'Theme', role: DEVELOPMENT_THEME_ROLE})!
  const adminSession = {token: '', storeFqdn: ''}
  const remoteChecksums: Checksum[] = []
  const files = new Map<string, ThemeAsset>([])
  const defaultThemeFileSystem = fakeThemeFileSystem('tmp', files)

  describe('files only present on remote developer theme', () => {
    test('should download assets from remote theme when `remote` source is selected', async () => {
      // Given
      vi.mocked(renderSelectPrompt).mockResolvedValue(REMOTE_STRATEGY)
      const assetToBeDownloaded = {checksum: '2', key: 'templates/second_asset.json', value: 'content'}
      const remoteChecksums = [assetToBeDownloaded]

      vi.mocked(fetchThemeAsset).mockResolvedValue(assetToBeDownloaded)

      // When
      expect(defaultThemeFileSystem.files.get('templates/asset.json')).toBeUndefined()
      await initializeThemeEditorSync(developmentTheme, adminSession, remoteChecksums, defaultThemeFileSystem)

      // Then
      expect(fetchThemeAsset).toHaveBeenCalledWith(developmentTheme.id, assetToBeDownloaded.key, adminSession)
      expect(defaultThemeFileSystem.files.get('templates/second_asset.json')).toEqual(assetToBeDownloaded)
    })

    test('should delete assets from local disk when `local` source is selected', async () => {
      // Given
      vi.mocked(renderSelectPrompt).mockResolvedValue(LOCAL_STRATEGY)
      const assetToBeDeleted = {checksum: '2', key: 'templates/asset.json'}
      const remoteChecksums = [assetToBeDeleted]

      // When
      await initializeThemeEditorSync(developmentTheme, adminSession, remoteChecksums, defaultThemeFileSystem)

      // Then
      expect(deleteThemeAsset).toHaveBeenCalledWith(developmentTheme.id, assetToBeDeleted.key, adminSession)
      expect(defaultThemeFileSystem.files.get('templates/asset.json')).toBeUndefined()
    })
  })

  describe('files only present on local developer theme', () => {
    test('should delete files from local disk when `remote` source is selected', async () => {
      // Given
      vi.mocked(renderSelectPrompt).mockResolvedValue(REMOTE_STRATEGY)
      const files = new Map([['templates/asset.json', {checksum: '1', key: 'templates/asset.json'}]])
      const localThemeFileSystem = fakeThemeFileSystem('tmp', files)
      const spy = vi.spyOn(localThemeFileSystem, 'delete')

      // When
      await initializeThemeEditorSync(developmentTheme, adminSession, remoteChecksums, localThemeFileSystem)

      // Then
      expect(spy).toHaveBeenCalledWith('templates/asset.json')
    })

    test('should not delete files from local disk when `local` source is selected', async () => {
      // Given
      vi.mocked(renderSelectPrompt).mockResolvedValue(LOCAL_STRATEGY)
      const files = new Map([['templates/asset.json', {checksum: '1', key: 'templates/asset.json'}]])
      const localThemeFileSystem = fakeThemeFileSystem('tmp', files)
      const spy = vi.spyOn(localThemeFileSystem, 'delete')

      // When
      await initializeThemeEditorSync(developmentTheme, adminSession, remoteChecksums, localThemeFileSystem)

      // Then
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('files with conflicting checksums', () => {
    test('should download files from remote theme when `remote` source is selected', async () => {
      // Given
      vi.mocked(renderSelectPrompt).mockResolvedValue(REMOTE_STRATEGY)
      const files = new Map([['templates/asset.json', {checksum: '1', key: 'templates/asset.json'}]])
      const localThemeFileSystem = fakeThemeFileSystem('tmp', files)
      const remoteChecksums = [{checksum: '2', key: 'templates/asset.json'}]

      // When
      await initializeThemeEditorSync(developmentTheme, adminSession, remoteChecksums, localThemeFileSystem)

      // Then
      expect(fetchThemeAsset).toHaveBeenCalled()
    })

    test('should not download files from remote when `local` source is selected', async () => {
      // Given
      vi.mocked(renderSelectPrompt).mockResolvedValue(LOCAL_STRATEGY)
      const files = new Map([['templates/asset.json', {checksum: '1', key: 'templates/asset.json'}]])
      const localThemeFileSystem = fakeThemeFileSystem('tmp', files)
      const remoteChecksums = [{checksum: '2', key: 'templates/asset.json'}]

      // When
      await initializeThemeEditorSync(developmentTheme, adminSession, remoteChecksums, localThemeFileSystem)

      // Then
      expect(fetchThemeAsset).not.toHaveBeenCalled()
    })
  })

  describe('pollRemoteChanges', async () => {
    test('should download modified files from the remote theme', async () => {
      // Given
      const remoteChecksums = [{checksum: '1', key: 'templates/asset.json'}]
      const updatedRemoteChecksums = [{checksum: '2', key: 'templates/asset.json'}]
      vi.mocked(fetchChecksums).mockResolvedValue(updatedRemoteChecksums)
      vi.mocked(fetchThemeAsset).mockResolvedValue({checksum: '2', key: 'templates/asset.json', value: 'content'})

      // When
      await pollRemoteChanges(developmentTheme, adminSession, remoteChecksums, defaultThemeFileSystem)

      // Then
      expect(defaultThemeFileSystem.files.get('templates/asset.json')).toEqual({
        checksum: '2',
        key: 'templates/asset.json',
        value: 'content',
      })
    })

    test('should download newly added files from remote theme', async () => {
      // Given
      const remoteChecksums: Checksum[] = []
      const updatedRemoteChecksums = [{checksum: '1', key: 'templates/asset.json'}]
      vi.mocked(fetchChecksums).mockResolvedValue(updatedRemoteChecksums)
      vi.mocked(fetchThemeAsset).mockResolvedValue({checksum: '1', key: 'templates/asset.json', value: 'content'})

      // When
      await pollRemoteChanges(developmentTheme, adminSession, remoteChecksums, defaultThemeFileSystem)

      // Then
      expect(defaultThemeFileSystem.files.get('templates/asset.json')).toEqual({
        checksum: '1',
        key: 'templates/asset.json',
        value: 'content',
      })
    })

    test('should delete local file from remote theme when there is a change on remote', async () => {
      // Given
      const remoteChecksums = [{checksum: '1', key: 'templates/asset.json'}]
      vi.mocked(fetchChecksums).mockResolvedValue([])

      // When
      await pollRemoteChanges(developmentTheme, adminSession, remoteChecksums, defaultThemeFileSystem)

      // Then
      expect(fetchThemeAsset).not.toHaveBeenCalled()
      expect(defaultThemeFileSystem.files.get('templates/asset.json')).toBeUndefined()
    })

    test('should throw an error when there is a change on remote and local', async () => {
      // Given
      const remoteChecksums = [{checksum: '1', key: 'templates/asset.json'}]
      const updatedRemoteChecksums = [{checksum: '2', key: 'templates/asset.json'}]
      vi.mocked(fetchChecksums).mockResolvedValue(updatedRemoteChecksums)
      vi.spyOn(process, 'exit').mockResolvedValue(null as never)

      const localThemeFileSystem: ThemeFileSystem = {
        root: 'tmp',
        files,
        delete: async (assetKey: string) => {
          files.delete(assetKey)
        },
        write: async (asset: ThemeAsset) => {
          files.set(asset.key, asset)
        },
        read: async (assetKey: string) => {
          files.set(assetKey, {checksum: '3', key: assetKey})
          return files.get(assetKey)?.value || files.get(assetKey)?.attachment
        },
      }

      // When
      // Then
      await expect(() =>
        pollRemoteChanges(developmentTheme, adminSession, remoteChecksums, localThemeFileSystem),
      ).rejects.toThrow(
        new AbortError(
          `Detected changes to the file 'templates/asset.json' on both local and remote sources. Aborting...`,
        ),
      )
    })

    test('should do nothing when there is a change on local only', async () => {
      // Given
      const remoteChecksums = [{checksum: '1', key: 'templates/asset.json'}]
      const updatedRemoteChecksums = [{checksum: '1', key: 'templates/asset.json'}]
      const spy = vi.spyOn(defaultThemeFileSystem, 'delete')

      vi.mocked(fetchChecksums).mockResolvedValue(updatedRemoteChecksums)
      vi.mocked(readThemeFilesFromDisk).mockImplementation(
        async (_filesToRead: ThemeAsset[], themeFileSystem: ThemeFileSystem) => {
          themeFileSystem.files.set('templates/asset.json', {checksum: '3', key: 'templates/asset.json'})
        },
      )

      // When
      await pollRemoteChanges(developmentTheme, adminSession, remoteChecksums, defaultThemeFileSystem)

      // Then
      expect(fetchThemeAsset).not.toHaveBeenCalled()
      expect(spy).not.toHaveBeenCalled()
    })
  })
})
