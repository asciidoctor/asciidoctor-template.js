module.exports = Builder;

var async = require('async');
var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var https = require('https');
var http = require('http');
var os = require('os');
var zlib = require('zlib');
var tar = require('tar-fs');
var concat = require('./concat.js');
var Uglify = require('./uglify.js');
var OpalCompiler = require('./opal-compiler.js');
var Log = require('./log.js');
var uglify = new Uglify();
var log = new Log();

var stdout;

String.prototype.endsWith = function(suffix) {
  return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

var deleteFolderRecursive = function(path) {
  var files = [];
  if (fs.existsSync(path)) {
    files = fs.readdirSync(path);
    files.forEach(function(file){
      var curPath = path + "/" + file;
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

// https://github.com/jprichardson/node-fs-extra/blob/master/lib/mkdirs/mkdirs-sync.js
var mkdirsSync = function(p, made) {
  p = path.resolve(p);
  try {
    fs.mkdirSync(p);
    made = made || p;
  } catch (err0) {
    switch (err0.code) {
      case 'ENOENT' :
        made = mkdirsSync(path.dirname(p), made);
        mkdirsSync(p, made);
        break;

      // In the case of any other error, just see if there's a dir
      // there already.  If so, then hooray!  If not, then something
      // is borked.
      default:
        var stat;
        try {
          stat = fs.statSync(p);
        } catch (err1) {
          throw err0;
        }
        if (!stat.isDirectory()) throw err0;
        break;
    }
  }
  return made;
}

var copyDir = function(src, dest) {
  var exists = fs.existsSync(src);
  var stats = exists && fs.statSync(src);
  var isDirectory = exists && stats.isDirectory();
  if (exists && isDirectory) {
    fs.readdirSync(src).forEach(function(childItemName) {
      copyDir(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    mkdirsSync(path.dirname(dest));
    var data = fs.readFileSync(src);
    fs.writeFileSync(dest, data);
  }
};

var walk = function(currentDirPath, callback) {
  fs.readdirSync(currentDirPath).forEach(function(name) {
    var filePath = path.join(currentDirPath, name);
    var stat = fs.statSync(filePath);
    if (stat.isFile()) {
      callback(filePath, stat);
    } else if (stat.isDirectory()) {
      walk(filePath, callback);
    }
  });
};

var javaVersionText = function() {
  var result = child_process.execSync('java -version 2>&1', {encoding: 'utf8'});
  var firstLine = result.split('\n')[0];
  var javaVersion = firstLine.match(/"(.*?)"/i)[1];
  return javaVersion.replace(/\./g, '').replace(/_/g, '');
};

function Builder() {
  this.templatesVersion = 'master';
}

Builder.prototype.build = function(callback) {
  if (process.env.DRY_RUN) {
    log.debug('build');
    callback();
    return;
  }
  var builder = this;
  var start = process.hrtime();

  async.series([
    function(callback) { builder.clean(callback); }, // clean
    function(callback) { builder.downloadDependencies(callback); }, // download dependencies
    function(callback) { builder.compile(callback); }, // compile
    function(callback) { builder.uglify(callback); } // uglify (optional)
  ], function() {
    log.success('Done in ' + process.hrtime(start)[0] + 's');
    typeof callback === 'function' && callback();
  });
};

Builder.prototype.clean = function(callback) {
  log.title('clean');
  this.deleteBuildFolder(); // delete build folder
  callback();
};

Builder.prototype.downloadDependencies = function(callback) {
  log.title('download dependencies');

  var builder = this;
  async.series([
    function(callback) { builder.getContentFromURL('https://codeload.github.com/asciidoctor/asciidoctor-reveal.js/tar.gz/' + builder.templatesVersion, 'build/templates-revealjs.tar.gz', callback); },
    function(callback) { builder.untar('build/templates-revealjs.tar.gz', 'templates-revealjs', 'build', callback); }
  ], function() {
    typeof callback === 'function' && callback();
  });
}

Builder.prototype.untar = function(source, baseDirName, destinationDir, callback) {
  var stream = fs.createReadStream(source).pipe(zlib.createGunzip()).pipe(tar.extract(destinationDir, {
    map: function (header) {
      // REMIND Do NOT user path.sep!
      // In this case, even on Windows, the separator is '/'.
      var paths = header.name.split('/');
      // replace base directory with 'baseDirName'
      paths.shift();
      paths.unshift(baseDirName);
      header.name = paths.join('/');
      return header;
    }
  }));
  stream.on('finish', function () {
    callback();
  });
}

Builder.prototype.dist = function(releaseVersion) {
  var builder = this;
  var start = process.hrtime();

  async.series([
    function(callback) { builder.build(callback); },
    function(callback) { builder.copyToDist(callback); }
  ], function() {
    log.success('Done in ' + process.hrtime(start)[0] + 's');
  });
};

Builder.prototype.release = function(releaseVersion) {
  var builder = this;
  var start = process.hrtime();

  async.series([
    function(callback) { builder.prepareRelease(releaseVersion, callback); },
    function(callback) { builder.build(callback); },
    function(callback) { builder.copyToDist(callback); },
    function(callback) { builder.commit(releaseVersion, callback); },
    function(callback) { builder.publish(callback); },
    function(callback) { builder.prepareNextIteration(callback); },
    function(callback) { builder.completeRelease(releaseVersion, callback); }
  ], function() {
    log.success('Done in ' + process.hrtime(start)[0] + 's');
  });
};

Builder.prototype.prepareRelease = function(releaseVersion, callback) {
  log.title('Release version: ' + releaseVersion);

  if (process.env.DRY_RUN) {
    log.warn('Dry run! To perform the release, run the command again without DRY_RUN environment variable');
  }

  this.replaceFileSync('package.json', /"version": "(.*?)"/g, '"version": "' + releaseVersion + '"');
  this.replaceFileSync('bower.json', /"version": "(.*?)"/g, '"version": "' + releaseVersion + '"');
  callback();
};

Builder.prototype.commit = function(releaseVersion, callback) {
  this.execSync('git add -A .');
  this.execSync('git commit -m "Release ' + releaseVersion + '"');
  this.execSync('git tag v' + releaseVersion);
  callback();
};

Builder.prototype.prepareNextIteration = function(callback) {
  this.deleteDistFolder();
  this.execSync('git add -A .');
  this.execSync('git commit -m "Prepare for next development iteration"');
  callback();
};

Builder.prototype.publish = function(callback) {
  if (process.env.SKIP_PUBLISH) {
    log.info('SKIP_PUBLISH environment variable is defined, skipping "publish" task');
    callback();
    return;
  }
  this.execSync('npm publish');
  callback();
};

Builder.prototype.completeRelease = function(releaseVersion, callback) {
  console.log('');
  log.info('To complete the release, you need to:');
  log.info("[ ] push changes upstream: 'git push origin master && git push origin v" + releaseVersion + "'");
  log.info("[ ] publish a release page on GitHub: https://github.com/mogztter/asciidoctor.js-backend-template/releases/new");
  callback();
};

Builder.prototype.concat = function(message, files, destination) {
  log.debug(message);
  concat(files, destination);
};

Builder.prototype.deleteBuildFolder = function() {
  log.debug('delete build directory');
  deleteFolderRecursive('build');
  fs.mkdirSync('build');
};

Builder.prototype.deleteDistFolder = function() {
  log.debug('delete dist directory');
  deleteFolderRecursive('dist');
  fs.mkdirSync('dist');
};

Builder.prototype.replaceFileSync = function(file, regexp, newSubString) {
  log.debug('update ' + file);
  if (!process.env.DRY_RUN) {
    var data = fs.readFileSync(file, 'utf8');
    var dataUpdated = data.replace(regexp, newSubString);
    fs.writeFileSync(file, dataUpdated, 'utf8');
  }
};

Builder.prototype.execSync = function(command) {
  log.debug(command);
  if (!process.env.DRY_RUN) {
    stdout = child_process.execSync(command);
    process.stdout.write(stdout);
  }
};

Builder.prototype.uglify = function(callback) {
  // Preconditions
  // - MINIFY environment variable is defined
  if (!process.env.MINIFY) {
    log.info('MINIFY environment variable is not defined, skipping "minify" task');
    callback();
    return;
  }
  // - Java7 or higher is available in PATH
  try {
    if (javaVersionText() < '170') {
      log.warn('Closure Compiler requires Java7 or higher, skipping "minify" task');
      callback();
      return;
    }
  } catch (e) {
    log.warn('\'java\' binary is not available in PATH, skipping "minify" task');
    callback();
    return;
  }
  log.title('uglify');
  var files = [
    {source: 'build/asciidoctor-backend-template.js', destination: 'build/asciidoctor-backend-template.min.js' }
  ];

  var tasks = [];
  files.forEach(function(file) {
    var source = file.source;
    var destination = file.destination;
    log.transform('minify', source, destination);
    tasks.push(function(callback) { uglify.minify(source, destination, callback) });
  });
  async.parallelLimit(tasks, 4, callback);
};

Builder.prototype.copyToDist = function(callback) {
  var builder = this;

  log.title('copy to dist/');
  builder.deleteDistFolder();
  builder.copy('build/asciidoctor-backend-template.js', 'dist/main.js');
  builder.copy('build/asciidoctor-backend-template.min.js', 'dist/main.min.js');
  copyDir('build/templates-revealjs/templates/jade', 'dist/templates');
  typeof callback === 'function' && callback();
};

Builder.prototype.copyToDir = function(from, toDir) {
  var basename = path.basename(from);
  this.copy(from, toDir + '/' + basename);
};

Builder.prototype.copy = function(from, to) {
  log.transform('copy', from, to);
  var data = fs.readFileSync(from);
  fs.writeFileSync(to, data);
};

Builder.prototype.mkdirSync = function(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path);
  }
};

Builder.prototype.getContentFromURL = function(source, target, callback) {
  log.transform('get', source, target);
  var targetStream = fs.createWriteStream(target);
  var downloadModule;
  // startWith alternative
  if (source.lastIndexOf('https', 0) === 0) {
    downloadModule = https;
  } else {
    downloadModule = http;
  }
  downloadModule.get(source, function(response) {
    response.pipe(targetStream);
    targetStream.on('finish', function () {
      targetStream.close(callback);
    });
  });
};

Builder.prototype.compile = function(callback) {
  var builder = this;

  var opalCompiler = new OpalCompiler({dynamicRequireLevel: 'ignore'});

  this.mkdirSync('build');

  log.title('compile backends lib');
//  opalCompiler.compile('asciidoctor/core_ext/factory', 'build/asciidoctor-factory.js');
//  opalCompiler.compile('asciidoctor/core_ext/template', 'build/asciidoctor-template.js');
  opalCompiler.compile('asciidoctor/core_ext', 'build/asciidoctor-backend-template.js');

  callback();
};
