const { identity, memoizeWith, pipeP, paths } = require('ramda');
const pkgUp = require('pkg-up');
const readPkg = require('read-pkg');
const path = require('path');
const pLimit = require('p-limit');
const debug = require('debug')('semantic-release:monorepo');
const { getCommitFiles, getRoot } = require('./git-utils');
const { mapCommits } = require('./options-transforms');
const fs = require('fs');
const memoizedGetCommitFiles = memoizeWith(identity, getCommitFiles);

/**
 * Get the normalized PACKAGE root path, relative to the git PROJECT root.
 */
const getPackagePath = async () => {
  const packagePath = await pkgUp();
  const gitRoot = await getRoot();

  return path.relative(gitRoot, path.resolve(packagePath, '..'));
};

/**
 * Get the normalized PACKAGE root path, relative to the git PROJECT root.
 */
const getPackagesPaths = async () => {
  const packagePath = await pkgUp();
  const gitRoot = await getRoot();

  const rootPackagePath = path.relative(
    gitRoot,
    path.resolve(packagePath, '..')
  );

  fs.readFile(packagePath, 'utf8', (err, packageJson) => {
    if (err) {
      console.log('Reading package.json failed for path' + packagePath, err);
    }

    debug('File data:: "%s"', packageJson);

    console.log('File data:', packageJson);

    // Get list of paths of the dependencies

    packageJson = JSON.parse(packageJson);

    const paths = packageJson.targetDependencies;

    if (paths && paths.length > 0) {
      paths.push(path.relative(gitRoot, path.resolve(packagePath, '..')));
      debug('Package paths:: "%s"', paths);
      return paths;
    } else {
      const paths = [];
      paths.push(path.relative(gitRoot, path.resolve(packagePath, '..')));
      debug('Package paths: "%s"', paths);
      return paths;
    }
  });
};

const withFiles = async commits => {
  const limit = pLimit(Number(process.env.SRM_MAX_THREADS) || 500);
  return Promise.all(
    commits.map(commit =>
      limit(async () => {
        const files = await memoizedGetCommitFiles(commit.hash);
        return { ...commit, files };
      })
    )
  );
};

const onlyPackageCommits = async commits => {
  const packagePaths = await getPackagePath();
  debug('Filter commits by package path: "%s"', packagePaths);
  const commitsWithFiles = await withFiles(commits);
  // Convert package root path into segments - one for each folder
  // const packageSegments = packagePath.split(path.sep);

  const packagePathSegments = [];
  for (const path of packagePaths) {
    packagePathSegments.push(path.packagePath.split(path.sep));
  }

  return commitsWithFiles.filter(({ files, subject }) => {
    for (const packageSegments of packagePathSegments) {
      // Normalise paths and check if any changed files' path segments start
      // with that of the package root.
      const packageFile = files.find(file => {
        const fileSegments = path.normalize(file).split(path.sep);
        // Check the file is a *direct* descendent of the package folder (or the folder itself)
        return packageSegments.every(
          (packageSegment, i) => packageSegment === fileSegments[i]
        );
      });

      if (packageFile) {
        debug(
          'Including commit "%s" because it modified package file "%s".',
          subject,
          packageFile
        );
      }

      return !!packageFile;
    }
  });
};

// Async version of Ramda's `tap`
const tapA = fn => async x => {
  await fn(x);
  return x;
};

const logFilteredCommitCount = logger => async ({ commits }) => {
  const { name } = await readPkg();

  logger.log(
    'Found %s commits for package %s since last release',
    commits.length,
    name
  );
};

const withOnlyPackageCommits = plugin => async (pluginConfig, config) => {
  const { logger } = config;

  return plugin(
    pluginConfig,
    await pipeP(
      mapCommits(onlyPackageCommits),
      tapA(logFilteredCommitCount(logger))
    )(config)
  );
};

module.exports = {
  withOnlyPackageCommits,
  onlyPackageCommits,
  withFiles,
};
