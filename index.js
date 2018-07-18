const { createHash: createBlake2Hash } = require('blake2');
const { format: formatBytes, parse: parseBytes } = require('bytes');
const chalk = require('chalk');
const Table = require('cli-table');
const { createHash, randomBytes } = require('crypto');
const EventEmitter = require('events');
const { createReadStream, createWriteStream, unlink } = require('fs-extra');
const { last, round, uniq } = require('lodash');
const { MetroHash64, MetroHash128 } = require('metrohash');
const ora = require('ora');
const tmp = require('tmp');
const { Stream: XXHashStream } = require('xxhash');
const yargs = require('yargs');

const md5 = createCryptoHashFunc('md5');
const sha1 = createCryptoHashFunc('sha1');
const sha224 = createCryptoHashFunc('sha224');
const sha256 = createCryptoHashFunc('sha256');
const sha384 = createCryptoHashFunc('sha384');
const sha512 = createCryptoHashFunc('sha512');

const algorithms = {
  blake2b, md5, metroHash64, metroHash128,
  sha1, sha224, sha256, sha384, sha512,
  xxhash
};

exports.bin = function() {
  Promise
    .resolve()
    .then(start)
    .catch(err => console.error(chalk.red(err.stack)));
};

async function start() {

  const args = yargs

    .option('algorithms', {
      alias: 'a',
      choices: Object.keys(algorithms),
      description: 'Hash algorithms to test',
      type: 'array'
    })

    .option('attempts', {
      alias: 't',
      default: 10,
      description: 'Number of files to generate for each hash function',
      type: 'number'
    })

    .option('file-size', {
      alias: 's',
      coerce: value => parseBytes(value),
      default: '10MB',
      description: 'Size of the files to generate to test hash functions',
      type: 'string'
    })

    .option('dir', {
      alias: 'd',
      description: 'Directory in which to create the files that will be hashed (the files are deleted afterwards, but the directory is left untouched; defaults to the system\'s temporary directory)'
    })

    .argv;

  const algorithmsToTest = args.algorithms && args.algorithms.length ? uniq(args.algorithms) : Object.keys(algorithms);
  const attempts = args.attempts;
  const fileSize = args.fileSize;
  const dir = args.dir;
  const events = new EventEmitter();
  const totalAttempts = algorithmsToTest.length * attempts;

  console.log();
  console.log(`${chalk.bold('Algorithms:')} ${algorithmsToTest.join(', ')}`);
  console.log(`${chalk.bold('Attempts:')} ${attempts}`);
  console.log(`${chalk.bold('Individual file size:')} ${formatBytes(fileSize)}`);
  console.log(`${chalk.bold('Total file size per algorithm:')} ${formatBytes(fileSize * attempts)}`);
  console.log();

  const spinner = ora('Racing...').start();

  let attempt = 0;
  let currentAlgorithm;
  events.on('generate:start', i => spinner.text = `(${String(Math.round(attempt * 100 / totalAttempts)).padStart(3)}%) [${currentAlgorithm}] generating file ${i + 1}/${attempts}...`);
  events.on('hash:start', i => {
    spinner.text = `(${String(Math.round(attempt * 100 / totalAttempts)).padStart(3)}%) [${currentAlgorithm}] hashing file ${i + 1}/${attempts}...`;
    attempt++;
  });

  const digestSizes = {};
  const times = {};
  try {
    for (const algorithm of algorithmsToTest) {

      currentAlgorithm = algorithm;
      const result = await timeHashFunc(algorithms[algorithm], attempts, fileSize, dir, events);
      digestSizes[currentAlgorithm] = result.digestSize;
      times[currentAlgorithm] = result.time;

      spinner.succeed(`[${currentAlgorithm}] ${formatBytes(fileSize / (times[currentAlgorithm] / 1000))}/s`);
      if (attempt < totalAttempts) {
        spinner.start('Racing...');
      }
    }

    if (algorithmsToTest.length >= 2) {

      console.log();
      const bySpeed = algorithmsToTest.sort((a, b) => times[a] - times[b]);

      var table = new Table({
        head: [ 'Algorithm', 'Speed', 'Compared to next', 'Digest size' ]
      });

      for (const algorithm of bySpeed) {

        const bytesPerSecond = fileSize / (times[algorithm] / 1000);
        table.push([
          algorithm,
          `${formatBytes(bytesPerSecond)}/s`
        ]);

        const i = algorithmsToTest.indexOf(algorithm);
        const next = algorithmsToTest[i + 1];
        if (next) {
          const nextBytesPerSecond = fileSize / (times[algorithmsToTest[i + 1]] / 1000);
          const difference = bytesPerSecond - nextBytesPerSecond;
          last(table).push(`${round(difference * 100 / nextBytesPerSecond, 2)}% faster`);
        } else {
          last(table).push('');
        }

        last(table).push(`${digestSizes[algorithm]} bits`);
      }

      console.log(table.toString());
    }
  } catch (err) {
    spinner.fail(chalk.yellow(err.message));
  }

  console.log();
}

async function timeHashFunc(hashFunc, attempts = 10, fileSize = 10 * 1024 * 1024, dir = null, events = new EventEmitter()) {

  let digestSize;
  const times = [];
  for (let i = 0; i < attempts; i++) {

    events.emit('generate:start', i);
    const file = await generateRandomFile(fileSize, dir);
    events.emit('generate:end', i);

    const start = Date.now();
    events.emit('hash:start', i);
    const result = await hashFunc(file);
    events.emit('hash:end', i)
    times.push(Date.now() - start);

    if (result instanceof Buffer) {
      digestSize = result.length * 8;
    } else if (typeof result === 'number') {
      digestSize = 64;
    }

    await unlink(file);
  }

  return {
    digestSize,
    time: times.reduce((memo, time) => memo + time, 0) / times.length
  };
}

async function blake2b(file) {
  return new Promise((resolve, reject) => createReadStream(file)
    .on('error', reject)
    .pipe(createBlake2Hash('blake2b'))
    .once('finish', function() {
      resolve(this.read());
    }));
}

async function metroHash64(file) {
  const hash = new MetroHash64();
  return new Promise((resolve, reject) => createReadStream(file)
    .on('error', reject)
    .on('data', data => hash.update(data))
    .once('end', () => resolve(Buffer.from(hash.digest(), 'hex'))));
}

async function metroHash128(file) {
  const hash = new MetroHash128();
  return new Promise((resolve, reject) => createReadStream(file)
    .on('error', reject)
    .on('data', data => hash.update(data))
    .once('end', () => resolve(Buffer.from(hash.digest(), 'hex'))));
}

function createCryptoHashFunc(algorithm) {
  return file => {
    return new Promise((resolve, reject) => createReadStream(file)
      .on('error', reject)
      .pipe(createHash(algorithm))
      .once('finish', function() {
        resolve(this.read());
      }));
  };
}

async function xxhash(file) {
  return new Promise((resolve, reject) => createReadStream(file)
    .on('error', reject)
    .pipe(new XXHashStream(0xCAFEBABE))
    .once('finish', function() {
      resolve(this.read());
    }));
}

async function generateRandomFile(size = 10 * 1024 * 1024, dir = null, chunkSize = 1024) {

  const tmpFile = await createTmpFile({ dir });
  const stream = createWriteStream(tmpFile);
  for (let i = 0; i < size; i += chunkSize) {
    const currentSize = Math.min(chunkSize, size - i);
    stream.write(await generateRandomBytes(currentSize));
  }

  stream.end();

  return tmpFile;
}

function generateRandomBytes(size = 1024) {
  return new Promise((resolve, reject) => {
    randomBytes(size, (err, buf) => {
      if (err) {
        reject(err);
      } else {
        resolve(buf);
      }
    });
  });
}

function createTmpFile(options = {}) {
  return new Promise((resolve, reject) => {
    tmp.file(options, (err, path, fd, cleanupCallback) => {
      if (err) {
        reject(err);
      } else {
        resolve(path);
      }
    });
  });
}
