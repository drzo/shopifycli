import {outputDebug, outputInfo} from '@shopify/cli-kit/node/output'
import {AdminSession} from '@shopify/cli-kit/node/session'
import {Checksum, Theme, ThemeAsset, ThemeFileSystem} from '@shopify/cli-kit/node/themes/types'
import {renderError, renderInfo, renderSelectPrompt} from '@shopify/cli-kit/node/ui'
import {deleteThemeAsset, fetchChecksums, fetchThemeAsset} from '@shopify/cli-kit/node/themes/api'
import {AbortError} from '@shopify/cli-kit/node/error'

const POLLING_INTERVAL = 3000
export const LOCAL_STRATEGY = 'local'
export const REMOTE_STRATEGY = 'remote'

type ReconciliationStrategy = typeof LOCAL_STRATEGY | typeof REMOTE_STRATEGY | undefined

interface FilePartitions {
  localFilesToDelete: Checksum[]
  filesToDownload: Checksum[]
  remoteFilesToDelete: Checksum[]
}

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

async function reconcileThemeFiles(
  targetTheme: Theme,
  session: AdminSession,
  remoteChecksums: Checksum[],
  localThemeFileSystem: ThemeFileSystem,
) {
  const {filesOnlyPresentLocally, filesOnlyPresentOnRemote, filesWithConflictingChecksums} = identifyFilesToReconcile(
    remoteChecksums,
    localThemeFileSystem,
  )

  if (
    filesOnlyPresentLocally.length === 0 &&
    filesOnlyPresentOnRemote.length === 0 &&
    filesWithConflictingChecksums.length === 0
  ) {
    outputDebug('Local and remote checksums match - no need to reconcile theme assets')
    return localThemeFileSystem
  }

  const partitionedFiles = await partitionFilesByReconciliationStrategy({
    filesOnlyPresentLocally,
    filesOnlyPresentOnRemote,
    filesWithConflictingChecksums,
  })

  await performFileReconciliation(targetTheme, session, localThemeFileSystem, partitionedFiles)
}

function identifyFilesToReconcile(
  remoteChecksums: Checksum[],
  localThemeFileSystem: ThemeFileSystem,
): {
  filesOnlyPresentOnRemote: Checksum[]
  filesOnlyPresentLocally: Checksum[]
  filesWithConflictingChecksums: Checksum[]
} {
  const remoteChecksumKeys = new Set()
  const filesOnlyPresentOnRemote: Checksum[] = []
  const filesWithConflictingChecksums: Checksum[] = []

  remoteChecksums.forEach((remoteChecksum) => {
    remoteChecksumKeys.add(remoteChecksum.key)
    const localChecksum = localThemeFileSystem.files.get(remoteChecksum.key)

    if (!localChecksum) {
      filesOnlyPresentOnRemote.push(remoteChecksum)
    } else if (remoteChecksum.checksum !== localChecksum.checksum) {
      filesWithConflictingChecksums.push(remoteChecksum)
    }
  })

  const filesOnlyPresentLocally: Checksum[] = Array.from(localThemeFileSystem.files.values()).filter(
    (asset: ThemeAsset) => !remoteChecksumKeys.has(asset.key),
  )

  return {
    filesOnlyPresentOnRemote,
    filesOnlyPresentLocally,
    filesWithConflictingChecksums,
  }
}

async function promptFileReconciliationStrategy(
  files: Checksum[],
  title: string,
  options: {
    remote: {
      label: string
      callback: (files: Checksum[]) => void
    }
    local: {
      label: string
      callback: (files: Checksum[]) => void
    }
  },
): Promise<ReconciliationStrategy | undefined> {
  if (files.length === 0) {
    return
  }

  renderInfo({
    body: {
      list: {
        title,
        items: files.map((file) => file.key),
      },
    },
  })

  const selectedStrategy = await renderSelectPrompt({
    message: 'Reconciliation Strategy',
    choices: [
      {label: options.remote.label, value: REMOTE_STRATEGY},
      {label: options.local.label, value: LOCAL_STRATEGY},
    ],
  })

  if (selectedStrategy === REMOTE_STRATEGY) {
    options.remote.callback(files)
  } else {
    options.local.callback(files)
  }
}

async function performFileReconciliation(
  targetTheme: Theme,
  session: AdminSession,
  localThemeFileSystem: ThemeFileSystem,
  partitionedFiles: FilePartitions,
) {
  const {localFilesToDelete, filesToDownload, remoteFilesToDelete} = partitionedFiles

  const deleteLocalFiles = localFilesToDelete.map((file) => localThemeFileSystem.delete(file.key))
  const downloadRemoteFiles = filesToDownload.map(async (file) => {
    const asset = await fetchThemeAsset(targetTheme.id, file.key, session)
    if (asset) {
      return localThemeFileSystem.write(asset)
    }
  })
  const deleteRemoteFiles = remoteFilesToDelete.map((file) => deleteThemeAsset(targetTheme.id, file.key, session))

  await Promise.all([...deleteLocalFiles, ...downloadRemoteFiles, ...deleteRemoteFiles])
}

async function partitionFilesByReconciliationStrategy(files: {
  filesOnlyPresentLocally: Checksum[]
  filesOnlyPresentOnRemote: Checksum[]
  filesWithConflictingChecksums: Checksum[]
}): Promise<FilePartitions> {
  const {filesOnlyPresentLocally, filesOnlyPresentOnRemote, filesWithConflictingChecksums} = files

  const localFilesToDelete: Checksum[] = []
  const filesToDownload: Checksum[] = []
  const remoteFilesToDelete: Checksum[] = []

  await promptFileReconciliationStrategy(
    filesOnlyPresentLocally,
    'The files listed below are only present locally. What would you like to do?',
    {
      remote: {
        label: 'Delete files from the local directory',
        callback: (files) => {
          localFilesToDelete.push(...files)
        },
      },
      local: {
        label: 'Upload local files to the remote theme',
        callback: () => {},
      },
    },
  )

  await promptFileReconciliationStrategy(
    filesOnlyPresentOnRemote,
    'The files listed below are only present on the remote theme. What would you like to do?',
    {
      remote: {
        label: 'Download remote files to the local directory',
        callback: (files) => {
          filesToDownload.push(...files)
        },
      },
      local: {
        label: 'Delete files from the remote theme',
        callback: (files) => {
          remoteFilesToDelete.push(...files)
        },
      },
    },
  )

  await promptFileReconciliationStrategy(
    filesWithConflictingChecksums,
    'The files listed below differ between the local and remote versions. What would you like to do?',
    {
      remote: {
        label: 'Keep the remote version',
        callback: (files) => {
          filesToDownload.push(...files)
        },
      },
      local: {
        label: 'Keep the local version',
        callback: () => {},
      },
    },
  )

  return {localFilesToDelete, filesToDownload, remoteFilesToDelete}
}

function pollThemeEditorChanges(
  targetTheme: Theme,
  session: AdminSession,
  remoteChecksum: Checksum[],
  localThemeFileSystem: ThemeFileSystem,
) {
  outputDebug('Checking for changes in the theme editor')

  return setTimeout(() => {
    pollRemoteChanges(targetTheme, session, remoteChecksum, localThemeFileSystem)
      .then((latestChecksums) => {
        pollThemeEditorChanges(targetTheme, session, latestChecksums, localThemeFileSystem)
      })
      .catch((error) => {
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
) {
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

  try {
    await abortIfMultipleSourcesChange(localFileSystem, assetsChangedOnRemote)
  } catch (error) {
    if (error instanceof AbortError) {
      renderError({body: error.message})
      process.exit(1)
    }
    throw error
  }

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
