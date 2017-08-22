module.exports = Builder;

var async = require('async');
var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var https = require('https');
var http = require('http');
var os = require('os');
var OpalCompiler = require('./opal-compiler.js');
var log = require('bestikk-log');
var bfs = require('bestikk-fs');

var stdout;

function Builder() {
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
    function(callback) { builder.compile(callback); }, // compile
    function(callback) { builder.generateUMD(callback); }, // UMD
    function(callback) { builder.uglify(callback); } // uglify (optional)
  ], function() {
    log.success('Done in ' + process.hrtime(start)[0] + 's');
    typeof callback === 'function' && callback();
  });
};

Builder.prototype.clean = function(callback) {
  log.task('clean');
  this.removeBuildDirSync(); // remove build directory
  callback();
};

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
    function(callback) { builder.publish(callback); },
    function(callback) { builder.completeRelease(releaseVersion, callback); }
  ], function() {
    log.success('Done in ' + process.hrtime(start)[0] + 's');
  });
};

const parseTemplate = function (templateFile, templateModel) {
  return fs.readFileSync(templateFile, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => {
      if(line in templateModel){
        return templateModel[line];
      } else {
        return line;
      }
    })
    .join('\n');
};

Builder.prototype.generateUMD = function (callback) {
  log.task('generate UMD');

  const templateModel = {
    '//#{asciidoctorTemplateCode}': fs.readFileSync('build/asciidoctor-backend-template.js', 'utf8')
  };

  const content = parseTemplate('src/template-asciidoctor-template.js', templateModel);
  fs.writeFileSync('build/asciidoctor-template.js', content, 'utf8');
  callback();
};

Builder.prototype.prepareRelease = function(releaseVersion, callback) {
  log.task('Release version: ' + releaseVersion);

  if (process.env.DRY_RUN) {
    log.warn('Dry run! To perform the release, run the command again without DRY_RUN environment variable');
  } else {
    this.execSync(`npm version ${releaseVersion}`);
  }
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
  log.info("[ ] publish a release page on GitHub: https://github.com/asciidoctor/asciidoctor-template.js/releases/new");
  callback();
};

Builder.prototype.removeBuildDirSync = function() {
  log.debug('remove build directory');
  bfs.removeSync('build');
  bfs.mkdirsSync('build');
};

Builder.prototype.removeDistDirSync = function() {
  log.debug('remove dist directory');
  bfs.removeSync('dist');
  bfs.mkdirsSync('dist');
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
  var uglify = require('bestikk-uglify');
  log.task('uglify');
  var files = [
    {source: 'build/asciidoctor-template.js', destination: 'build/asciidoctor-template.min.js' }
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

  log.task('copy to dist/');
  builder.removeDistDirSync();
  bfs.copySync('build/asciidoctor-template.js', 'dist/main.js');
  bfs.copySync('build/asciidoctor-template.min.js', 'dist/main.min.js');
  typeof callback === 'function' && callback();
};

Builder.prototype.compile = function(callback) {
  var builder = this;

  var opalCompiler = new OpalCompiler({dynamicRequireLevel: 'ignore'});

  bfs.mkdirsSync('build');

  log.task('compile template backend');
  opalCompiler.compile('asciidoctor/core_ext', 'build/asciidoctor-backend-template.js');

  callback();
};
