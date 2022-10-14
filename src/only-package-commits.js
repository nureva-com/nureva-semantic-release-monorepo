const { identity, memoizeWith, pipeP } = require('ramda');
const pkgUp = require('pkg-up');
const readPkg = require('read-pkg');
const path = require('path');
const pLimit = require('p-limit');
const debug = require('debug')('semantic-release:monorepo');
const { getCommitFiles, getRoot } = require('./git-utils');
const { mapCommits } = require('./options-transforms');
const fs = require('fs').promises;
const memoizedGetCommitFiles = memoizeWith(identity, getCommitFiles);

/**
 * Get the normalized PACKAGE root path, relative to the git PROJECT root.
 */
const getPackagePath = async () => {
  const packagePath = await pkgUp();
  const gitRoot = await getRoot();

  return path.relative(gitRoot, path.resolve(packagePath, '..'));
};

const getPackagesPaths = async () => {
  const packagePath = await pkgUp();
  const gitRoot = await getRoot();

  const rootPackagePath = path.relative(
    gitRoot,
    path.resolve(packagePath, '..')
  );

  let packageJson = await fs.readFile(packagePath, 'utf8');

  //(err, packageJson) => {
  // if (err) {
  //   console.log('Reading package.json failed for path' + packagePath, err);
  // }

  debug('File data:: "%s"', packageJson);

  console.log('File data:', packageJson);

  // Get list of paths of the dependencies

  packageJson = JSON.parse(packageJson);

  let paths = packageJson.targetDependencies;

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
  let packagePaths = await getPackagesPaths();

  // packagePath = packagePath[1];

  debug('Filter commits by package path: "%s"', packagePaths);
  debug('!!!!!!!!!!QAEQWEQWWQEQWE');

  const commitsWithFiles = await withFiles(commits);
  // Convert package root path into segments - one for each folder

  // for (const commit of commitsWithFiles) {
  //   debug('Commit: "%s"', commit);
  // }

  for (const packagePath of packagePaths) {
    debug('packagePath: "%s"', packagePath);
  }

  return commitsWithFiles.filter(({ files, subject }) => {
    let packageFile = false;
    for (let packagePath of packagePaths) {
      let packageSegments = packagePath.split(path.sep);
      debug('packageSegments: "%s"', packageSegments);

      // Normalise paths and check if any changed files' path segments start
      // with that of the package root.
      packageFile = files.find(file => {
        let fileSegments = path.normalize(file).split(path.sep);
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
    }
    return !!packageFile;
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

module.exports = withOnlyPackageCommits;
