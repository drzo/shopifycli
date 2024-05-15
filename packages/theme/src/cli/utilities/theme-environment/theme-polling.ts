import {Checksum, Theme, ThemeFileSystem} from '@shopify/cli-kit/node/themes/types'
import {fetchChecksums, fetchThemeAsset} from '@shopify/cli-kit/node/themes/api'
import {outputDebug, outputInfo} from '@shopify/cli-kit/node/output'
import {AdminSession} from '@shopify/cli-kit/node/session'
import {AbortError, FatalError} from '@shopify/cli-kit/node/error'

const POLLING_INTERVAL = 3000

export function pollThemeEditorChanges(
  targetTheme: Theme,
  session: AdminSession,
  remoteChecksum: Checksum[],
  localThemeFileSystem: ThemeFileSystem,
) {
  outputDebug('Listening for changes in the theme editor')

  return setTimeout(() => {
    pollRemoteChanges(targetTheme, session, remoteChecksum, localThemeFileSystem)
      .then((latestChecksums) => {
        pollThemeEditorChanges(targetTheme, session, latestChecksums, localThemeFileSystem)
      })
      .catch((error) => {
        if (error instanceof FatalError) {
          throw error
        }
        outputDebug(`Error while checking for changes in the theme editor: ${error.message}`)
        pollThemeEditorChanges(targetTheme, session, remoteChecksum, localThemeFileSystem)
      })
  }, POLLING_INTERVAL)
}

export async function pollRemoteChanges(
  targetTheme: Theme,
  currentSession: AdminSession,
  remoteChecksums: Checksum[],
  localFileSystem: ThemeFileSystem,
): Promise<Checksum[]> {
  const latestChecksums = await fetchChecksums(targetTheme.id, currentSession)

  const previousChecksums = new Map(remoteChecksums.map((checksum) => [checksum.key, checksum]))
  const assetsChangedOnRemote = latestChecksums.filter((latestAsset) => {
    const previousAsset = previousChecksums.get(latestAsset.key)
    if (!previousAsset || previousAsset.checksum !== latestAsset.checksum) {
      return true
    }
  })

  const latestChecksumsMap = new Map(latestChecksums.map((checksum) => [checksum.key, checksum]))
  const assetsDeletedFromRemote = remoteChecksums.filter((previousChecksum) => {
    return latestChecksumsMap.get(previousChecksum.key) === undefined
  })

  await abortIfMultipleSourcesChange(localFileSystem, assetsChangedOnRemote)

  await Promise.all(
    assetsChangedOnRemote.map(async (file) => {
      const asset = await fetchThemeAsset(targetTheme.id, file.key, currentSession)
      if (asset) {
        return localFileSystem.write(asset).then(() => {
          outputInfo(`Synced: get '${asset.key}' from remote theme`)
        })
      }
    }),
  )

  await Promise.all(
    assetsDeletedFromRemote.map((file) =>
      localFileSystem.delete(file.key).then(() => {
        outputInfo(`Synced: remove '${file.key}' from local theme`)
      }),
    ),
  )
  return latestChecksums
}

async function abortIfMultipleSourcesChange(localFileSystem: ThemeFileSystem, assetsChangedOnRemote: Checksum[]) {
  for (const asset of assetsChangedOnRemote) {
    const previousChecksum = localFileSystem.files.get(asset.key)?.checksum
    // eslint-disable-next-line no-await-in-loop
    await localFileSystem.read(asset.key)
    const newChecksum = localFileSystem.files.get(asset.key)?.checksum
    if (previousChecksum !== newChecksum) {
      throw new AbortError(
        `Detected changes to the file 'templates/asset.json' on both local and remote sources. Aborting...`,
      )
    }
  }
}
