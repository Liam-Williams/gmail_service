'use strict';

var async           = require('async');
var atob            = require('atob');
var moment          = require('moment');
var google          = require('googleapis');
var gmail           = google.gmail('v1');
var GoogleOAuth2    = google.auth.OAuth2;

var User            = require('../../models/user');
var cryptoUtil      = require('../../utils/crypto-util');

var valueInParenthesis = /<.*>/;
var gmailDateFormat = 'ddd, DD MMM YYYY HH:mm:ss Z';

var getGoogleOauthClient = exports.getGoogleOauthClient = function(user, gmailUser, googleClient, callback) {

    var token = cryptoUtil.decrypt(gmailUser.accessToken);
    var refreshToken = cryptoUtil.decrypt(gmailUser.refreshToken);
    var googleClient = new GoogleOAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK);
    googleClient.setCredentials({
      access_token: token,
      refresh_token: refreshToken
    });

    if (new Date().getTime() > gmailUser.expires_at){
        console.log('expired token attempting resfresh');
        googleClient.refreshAccessToken(function(err, tokens) {
            if (err) return callback(err);
            var token = cryptoUtil.encrypt(tokens.access_token);
            var refreshToken = cryptoUtil.encrypt(tokens.refresh_token);
            var update = {'google.$.accessToken': token, 'google.$.refreshToken': refreshToken, 'google.$.expires_at': tokens.expiry_date};
            User.findOneAndUpdate({_id: user._id, 'google.id': gmailUser.id}, {$set: update}, {new: true}, function(err, nMe){
                callback(err, nMe, googleClient);
            });
        });

    } else callback(null, null, googleClient);
}

exports.getGmailMessages = function(req, res, next){
    User.findOne({_id: req.user._id}, function(err, user){
        if (err) { console.log(err); res.status(500).end(); };
        if (!user) { console.log('Couldn\'t find me'); res.status(500).end(); }
        if (!user.google) { console.log('No gmail on user'); res.status(500).end(); }
        if (false && user.google.length) {
            return getGmailMessagesSince(user, req, res, next);
        } else {
            return getGmailAllMessages(user, req, res, next);
        }
    });
}

var getGmailAllMessages = exports.getGmailAllMessages = function(me, req, res, next) {
    var guser = me.google[0];
    var googleClient;

    async.parallel([
    function(callback){
        getGoogleOauthClient(me, guser, googleClient, function(err, user, _googleClient){
            if (user) me = user;
            if (_googleClient) googleClient = _googleClient;
            callback(err);
        });
    }], function(err){
        if (err) { console.log(err); return res.status(500).end(); }
        if (!googleClient) { console.log('no google OAuth Client'); return res.status(500).end(); }
        gmail.users.messages.list({auth: googleClient, userId: guser.id}, function(err, messages){
            if (err) { console.log(err); return res.status(500).end() };
            //can do with batch request
            async.mapSeries(messages.messages.splice(0,10), function(message, callback){
                getGmailMessage(me, guser, googleClient, message.id, callback);
            }, function(err, results){
                if (err) { console.log(err); return res.status(500).end(); }
                var topHistoryId = results[0].historyId;
                User.update({_id: me._id, 'google.id': guser.id}, {$set: {'google.$.historyId': topHistoryId}}, function(err){
                    if (err) console.log(err);
                });
                res.json({historyId: topHistoryId, messages: results});
            }); // end get all gmail messages
        }); // end list gmail messages
    }); // end async parallel
} // end api call

var getGmailMessagesSince = exports.getGmailMessagesSince = function(me, req, res, next) {

    var guser = me.google[0];
    var googleClient;

    async.parallel([
    function(callback){
        getGoogleOauthClient(me, guser, googleClient, function(err, user, _googleClient){
            if (user) me = user;
            if (_googleClient) googleClient = _googleClient;
            callback(err);
        });
    }], function(err){
        if (err) { console.log(err); return res.status(500).end(); }
        if (!googleClient) { console.log('no google OAuth Client'); return res.status(500).end(); }
        gmail.users.history.list({auth: googleClient, userId: guser.id, startHistoryId: guser.historyId}, function(err, history){
            if (err) { console.log(err); return res.status(500).end() };
            //can do with batch request
            //console.log(JSON.stringify(history, null, 3));
            var results = [];
            async.eachSeries(history.history.splice(0,10), function(history, callback){
                async.eachSeries(history.messages, function(message, messageCallback){
                    getGmailMessage(me, guser, googleClient, message.id, function(err, data){
                        results.push(data);
                        messageCallback(err);
                    });
                }, function(err){
                    callback(err);
                });

            }, function(err){
                if (err) { console.log(err); return res.status(500).end(); }
                var topHistoryId = guser.historyId;
                if (results.length){
                    topHistoryId = results[0].historyId;
                    User.update({_id: me._id, 'google.id': guser.id}, {$set: {'google.$.historyId': topHistoryId}}, function(err){
                        if (err) console.log(err);
                    });
                }
                res.json({historyId: topHistoryId, messages: results});
            }); // end get all gmail messages
        }); // end list gmail messages
    }); // end async parallel
} // end api call

var getGmailMessage = exports.getGmailMessage = function(user, googleUser, googleOAuthClient, messageId, callback) {
    gmail.users.messages.get({id: messageId, auth: googleOAuthClient, userId: googleUser.id}, function(err, message){
        if (err) callback(err);
        var headers = {};
        var tHeaders = message.payload.headers.filter(function(header){
            if (header.name == 'To' || header.name == 'From' || header.name == 'Cc' || header.name == 'Bcc'){
                var nHeaderValue = [];
                header.value.split(',').forEach(function(value){
                    value = value.trim();
                    var match = value.match(valueInParenthesis);
                    if (match && match.length){
                        var match1 = match[0];
                        var name = value.substring(0, match.index - 1);
                        var names = name.split(' ');
                        var firstName = names.shift();
                        var lastName = names.join(' ');
                        nHeaderValue.push({
                            email: match1.substring(1, match1.length -1),
                            firstName: firstName,
                            lastName: lastName
                        });
                    } else {
                        nHeaderValue.push({email: value});
                    }
                });
                header.value = nHeaderValue;
            } else if (header.name == 'Date') {
                var dateStr = header.value;
                header.value = {
                    milli: moment(dateStr, gmailDateFormat).unix() * 1000,
                    formatted: moment(dateStr, gmailDateFormat).format()
                }
            }
            return ['Subject', 'To', 'From', 'Date', 'Cc'].indexOf(header.name) >= 0;
        });
        tHeaders.forEach(function(header){
            headers[header.name] = header.value;
        });
        headers.participants = [];
        headers.recipients = [];
        if (headers['From']){
            headers['From'].forEach(function(to){
                headers.participants.push(to.email);
            });
        }
        if (headers['To']){
            headers['To'].forEach(function(to){
                headers.participants.push(to.email);
                headers.recipients.push(to.email);
            });
        }
        if (headers['Cc']){
            headers['Cc'].forEach(function(to){
                headers.participants.push(to.email);
                headers.recipients.push(to.email);
            });
        }
        if (headers['Bcc']) {
            headers['Bcc'].forEach(function(to){
                headers.participants.push(to.email);
                headers.recipients.push(to.email);
            });
        }
        if (message.payload.parts){
            headers.files = message.payload.parts.filter(function(part){ return part.filename; })
                .map(function(part){
                    return {
                        file_name: part.filename,
                        file_type: part.mimeType,
                        file_id: part.body.attachmentId
                    }
                });
        }

        headers.id = messageId;
        headers.owner = user._id;
        headers.historyId = message.historyId;

        if (message.payload.parts && message.payload.parts[0].parts){
            headers.content = message.payload.parts[0].parts.filter(function(part){
                return part.mimeType == 'text/plain';
            }).map(function(part){
                return atob( part.body.data.replace(/-/g, '+').replace(/_/g, '/') );
            }).join(' ');
        } else if (message.payload.parts) {
            headers.content = atob( message.payload.parts[0].body.data.replace(/-/g, '+').replace(/_/g, '/') );
        }
        if(message.labelIds.indexOf('SENT') >= 0) {
            headers.sent = true;
        } else {
            headers.sent = false;
        }
        callback(null, headers);
        //If message.labelIds.indexIf('SENT') >= 0, (sent flag on doc in db)
    });
}

