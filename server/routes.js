/**
 * Main application routes
 */

'use strict';

var passport = require('passport');

var gmailService = require('../gmail');

module.exports = function(app) {

  // Insert routes below
  app.use('/api/things', require('./api/thing'));

    app.get('/web/auth/google', passport.authenticate('google', { accessType: 'offline', approvalPrompt: 'force', scope: ['https://www.googleapis.com/auth/gmail.readonly', 'profile', 'email'] }));
    app.get('/web/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login.html', successRedirect: '/' }));
    app.get('/web/auth/google/messages', gmailService.getGmailMessages); // end api method


};
