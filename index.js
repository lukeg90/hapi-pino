'use strict'

const pino = require('pino')

const levels = ['trace', 'debug', 'info', 'warn', 'error']
module.exports.levelTags = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error'
}

function register (server, options, next) {
  options.serializers = options.serializers || {}
  options.serializers.req = options.serializers.req || asReqValue
  options.serializers.res = options.serializers.res || pino.stdSerializers.res
  options.serializers.err = options.serializers.err || pino.stdSerializers.err

  if (options.logEvents === undefined) {
    options.logEvents = ['onPostStart', 'onPostStop', 'response', 'request-error']
  }

  var logger
  if (options.instance) {
    options.instance.serializers = Object.assign(options.serializers, options.instance.serializers)
    logger = options.instance
  } else {
    var stream = options.stream
    delete options.stream
    logger = pino(options, stream)
  }

  const tagToLevels = Object.assign({}, module.exports.levelTags, options.tags)
  const allTags = options.allTags || 'info'

  const validTags = Object.keys(tagToLevels).filter((key) => levels.indexOf(tagToLevels[key]) < 0).length === 0
  if (!validTags || (allTags && levels.indexOf(allTags) < 0)) {
    return next(new Error('invalid tag levels'))
  }

  const mergeHapiLogData = options.mergeHapiLogData

  // expose logger as 'server.logger()'
  server.decorate('server', 'logger', () => logger)

  // set a logger for each request
  server.ext('onRequest', (request, reply) => {
    request.logger = logger.child({ req: request })
    reply.continue()
  })

  server.on('log', function (event) {
    logEvent(logger, event)
  })

  server.on('request', function (request, event) {
    request.logger = request.logger || logger.child({ req: request })
    logEvent(request.logger, event)
  })

  // log when a request completes with an error
  tryAddEvent(server, options, 'on', 'request-error', function (request, err) {
    request.logger.warn({
      res: request.raw.res,
      err: err
    }, 'request error')
  })

  // log when a request completes
  tryAddEvent(server, options, 'on', 'response', function (request) {
    const info = request.info
    request.logger.info({
      payload: options.logPayload ? request.payload : undefined,
      res: request.raw.res,
      responseTime: info.responded - info.received
    }, 'request completed')
  })

  tryAddEvent(server, options, 'ext', 'onPostStart', function (s, cb) {
    logger.info(server.info, 'server started')
    cb()
  })

  tryAddEvent(server, options, 'ext', 'onPostStop', function (s, cb) {
    logger.info(server.info, 'server stopped')
    cb()
  })

  next()

  function tryAddEvent (server, options, type, event, cb) {
    if (options.logEvents && options.logEvents.indexOf(event) !== -1) {
      server[type](event, cb)
    }
  }

  function logEvent (current, event) {
    var tags = event.tags
    var data = event.data
    var level
    var found = false

    var logObject
    if (mergeHapiLogData) {
      if (typeof data === 'string') {
        data = { msg: data }
      }

      logObject = Object.assign({ tags }, data)
    } else {
      logObject = { tags, data }
    }

    for (var i = 0; i < tags.length; i++) {
      level = tagToLevels[tags[i]]
      if (level) {
        current[level](logObject)
        found = true
        break
      }
    }

    if (!found && allTags) {
      current[allTags](logObject)
    }
  }
}

function asReqValue (req) {
  const raw = req.raw.req
  return {
    id: req.id,
    method: raw.method,
    url: raw.url,
    headers: raw.headers,
    remoteAddress: raw.connection.remoteAddress,
    remotePort: raw.connection.remotePort
  }
}

module.exports.register = register
module.exports.register.attributes = {
  pkg: require('./package')
}
