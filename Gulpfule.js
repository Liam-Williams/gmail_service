var gulp        = require('gulp');
var nodemon     = require('gulp-nodemon');

/**
 * Develop
 */
gulp.task('default', function() {
  nodemon({
    script: 'server/app.js',
    env: { 'NODE_ENV': 'development' },
    nodeArgs: ['--debug'],
  });
});