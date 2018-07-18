# HashRace

**Test the speed of various hash functions**

[![npm version](https://badge.fury.io/js/hashrace.svg)](https://badge.fury.io/js/hashrace)
[![license](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.txt)

```bash
npm install -g hashrace
hashrace
```

## Usage

This script generates random files, hashes them with various algorithms, and
computes the average speed of each algorithm.

The following options are available:

```
--help            Show help                                          [boolean]
--version         Show version number                                [boolean]
--algorithms, -a  Hash algorithms to test
    [array] [choices: "blake2b", "md5", "metroHash64", "metroHash128", "sha1",
                             "sha224", "sha256", "sha384", "sha512", "xxhash"]
--attempts, -t    Number of files to generate for each hash function
                                                        [number] [default: 10]
--file-size, -s   Size of the files to generate to test hash functions
                                                    [string] [default: "10MB"]
--dir, -d         Directory in which to create the files that will be hashed
                  (the files are deleted afterwards, but the directory is left
                  untouched; defaults to the system's temporary directory)
```
