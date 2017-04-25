// jasmine.DEFAULT_TIMEOUT_INTERVAL = 100000

const fs = require('fs')
const path = require('path')
const glob = require('glob')
const os = require('os')
const uuid = require('uuid')
// const exec = require('child-process-promise').exec

const HTMLEPUB = require('../lib')

const htmlFiles = glob.sync(path.join(__dirname, 'data', '*.html')).map(file => ({
  content: fs.readFileSync(file)
}))

const book = {
  title: 'Test Book',
  identifier: 'com.example/1',
  updated: '2017-01-01T00:00:00Z'
}

test('generates metadata', () => {
  const epub = new HTMLEPUB(book)

  expect(epub.metadata['dc:title']['#text']).toBe(book.title)
})

test('parses html', (done) => {
  const epub = new HTMLEPUB(book)

  epub.parse(htmlFiles[0].content).then($ => {
    try {
      expect($('h2').text()).toBe('Test Section')
      done()
    } catch (e) {
      done.fail(e)
    }
  })
})

test('produces xhtml', (done) => {
  const epub = new HTMLEPUB(book)

  epub.parse(htmlFiles[0].content).then($ => {
    try {
      expect($('html').attr('xmlns')).toBe('http://www.w3.org/1999/xhtml')
      done()
    } catch (e) {
      done.fail(e)
    }
  })
})

test('extracts files', (done) => {
  const resourceRoot = 'https://www.example.com/resources/'

  const epub = new HTMLEPUB(book, {resourceRoot})

  epub.load(htmlFiles).then(() => {
    try {
      const image = epub.images.find(item => item.source === resourceRoot + 'images/1.png')

      expect(image).not.toBeNull()
      done()
    } catch (e) {
      done.fail(e)
    }
  })
})

test('creates a zip file', (done) => {
  const epub = new HTMLEPUB(book)

  epub.load(htmlFiles).then(() => {
    const outputFile = os.tmpdir() + '/' + uuid() + '.epub'
    // const outputFile = os.tmpdir() + '/' + 'test.epub'
    console.log('Writing to', outputFile)

    const outputStream = fs.createWriteStream(outputFile)

    epub.stream(outputStream).then(archive => {
      outputStream.on('close', function () {
        console.log('Wrote', archive.pointer(), 'bytes')

        // TODO: run epubcheck if installed
        // exec('epubcheck ' + outputFile).then(result => {
        //   console.log(result.stdout)
        //   console.err(result.stderr)
        //   done()
        // }).catch(done.fail)

        done()
      })
    }).catch(done.fail)
  }).catch(done.fail)
})

test('generates properties', (done) => {
  const epub = new HTMLEPUB(book)

  epub.parse(htmlFiles[0].content).then($ => {
    try {
      const properties = epub.properties($)
      expect(properties).toEqual(['scripted', 'mathml', 'svg'])
      done()
    } catch (e) {
      done.fail(e)
    }
  })
})
