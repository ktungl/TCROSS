import Parse from 'parse'

const appId = import.meta.env.VITE_PARSE_APP_ID
const jsKey = import.meta.env.VITE_PARSE_JS_KEY
const serverUrl = import.meta.env.VITE_PARSE_SERVER_URL

Parse.initialize(appId, jsKey)
Parse.serverURL = serverUrl

export default Parse
