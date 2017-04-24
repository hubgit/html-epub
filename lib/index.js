const path = require('path')
// const fs = require('fs')
const uuid = require('uuid')
const cheerio = require('cheerio')
const tidy = require('libtidy')
const archiver = require('archiver')
const builder = require('xmlbuilder')
// const mmm = require('mmmagic')
// const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE)

// given a map of HTML filenames and their HTML data, plus metadata, generate an EPUB file
class HTMLEPUB {
  constructor (book = {}) {
    this.book = book
    this.xhtml = []
    this.images = []
  }

  load (files) {
    return Promise.all(files.map(file => {
      return this.parse(file.content).then($ => {
        const id = uuid()

        this.xhtml.push({
          id: 'xhtml-' + id,
          $: $,
          title: $('h1').text(),
          basename: file.basename,
          target: `xhtml/${id}.xhtml`
        })

        this.extract($)
      })
    }))
  }

  stream (outputStream) {
    const epub = this

    return new Promise((resolve, reject) => {
      const archive = archiver('zip')

      archive.on('error', reject)

      archive.pipe(outputStream)

      // mimetype - mandatory, must be the first file in the zip archive, must not be compressed
      archive.append('application/epub+zip', { name: 'mimetype', store: true })

      // META-INF/container.xml - mandatory, points to EPUB/package.opf
      archive.append(
        builder.create(this.container, {encoding: 'UTF-8'}).end({
          pretty: true
        }), {name: 'META-INF/container.xml'}
      )

      // EPUB/package.opf - describes the package contents
      archive.append(
        builder.create(this.package, {encoding: 'UTF-8'}).end({
          pretty: true
        }), { name: 'EPUB/package.opf' }
      )

      // EPUB/xhtml/toc.xhtml - table of contents
      archive.append(
        builder.create(this.toc, {encoding: 'UTF-8'}).dtd().end({
          pretty: true
        }), {name: 'EPUB/toc.xhtml'}
      )

      // TODO: add TOC in all the other possible formats?

      // EPUB/xhtml/*.xhtml - the chapters
      epub.xhtml.forEach(item => {
        archive.append(item.$.xml(), { name: 'EPUB/' + item.target })
      })

      // EPUB/images/* - the images
      epub.images.forEach(item => {
        let inputStream

        // TODO: convert relative URL to accessible file path
        // TODO: update the path in the HTML
        // TODO: sanitise/normalise item.source

        // inputStream = fs.createReadStream(item.source)
        inputStream = 'foo' // TODO

        archive.append(inputStream, { name: 'EPUB/' + item.target })
      })

      archive.finalize()

      resolve(archive)
    })
  }

  parse (html) {
    const epub = this

    // https://github.com/gagern/node-libtidy
    const doc = tidy.TidyDoc()

    // http://api.html-tidy.org/tidy/tidylib_api_5.2.0/quick_ref.html
    doc.options = {
      doctype: 'html5',
      output_xhtml: true,
      tidy_mark: false
    }

    return new Promise((resolve, reject) => {
      doc.tidyBuffer(html, (err, result) => {
        if (err) {
          reject(err)
        } else {
          console.warn(result.errlog)

          const $ = cheerio.load(result.output)
          $('title').text(epub.book.title)
          resolve($)
        }
      })
    })
  }

  extract ($) {
    const epub = this

    $('img[src]').each(function () {
      const id = uuid()

      const src = $(this).attr('src')
      const ext = path.extname(src)

      epub.images.push({
        id: 'image-' + id,
        source: src,
        basename: path.basename(src),
        target: `images/${id}${ext}`
      })
    })
  }

  get container () {
    return {
      container: {
        '@xmlns': 'urn:oasis:names:tc:opendocument:xmlns:container',
        '@version': '1.0',
        'rootfiles': {
          'rootfile': {
            '@full-path': 'EPUB/package.opf',
            '@media-type': 'application/oebps-package+xml'
          }
        }
      }
    }
  }

  get package () {
    return {
      package: {
        '@xmlns': 'http://www.idpf.org/2007/opf',
        '@version': '3.0',
        '@xml:lang': 'en',
        '@unique-identifier': 'uid',
        '@prefix': 'cc: http://creativecommons.org/ns#',
        metadata: this.metadata,
        manifest: this.manifest,
        spine: this.spine
      }
    }
  }

  get toc () {
    return {
      html: {
        '@xmlns': 'http://www.w3.org/1999/xhtml',
        '@xmlns:epub': 'http://www.idpf.org/2007/ops',
        head: {
          meta: {
            '@charset': 'utf-8'
          },
          title: this.book.title
        },
        body: {
          header: {
            h1: 'Contents'
          },
          nav: {
            '@epub:type': 'toc',
            ol: {
              li: this.xhtml.map(item => ({
                'a': {
                  '@href': item.target,
                  '#text': item.title
                }
              }))
            }
          }
        }
      }
    }
  }

  /**
   * A list of all the files in the package
   *
   * TODO: add 'properties': 'cover-image' to the cover image
   * TODO: add 'properties': 'remote-resources' if refers to resources outside the EPUB container
   */
  get manifest () {
    const item = [
      // TODO: add the cover page
      // {
      //   '@id': 'cover',
      //   '@href': 'cover.xhtml',
      //   '@media-type': 'application/xhtml+xml'
      // },
      {
        '@id': 'toc',
        '@href': 'toc.xhtml',
        '@media-type': 'application/xhtml+xml',
        '@properties': 'nav'
      }
    ]

    this.xhtml.forEach(file => {
      const data = {
        '@id': file.id,
        '@href': file.target,
        '@media-type': 'application/xhtml+xml'
      }

      const properties = this.properties(file.$)

      if (properties.length) {
        data['@properties'] = properties.join(' ')
      }

      item.push(data)
    })

    this.images.forEach(file => {
      item.push({
        '@id': file.id,
        '@href': file.target,
        '@media-type': 'application/octet-stream' // TODO: detect mime type with `magic`
      })
    })

    return { item }
  }

  /**
   * The order that XHTML pages should be displayed
   */
  get spine () {
    const itemref = [
      // TODO: add the cover page
      // {
      //   '@idref': 'cover',
      //   '@linear': 'no'
      // },
      {
        '@idref': 'toc'
      }
    ]

    this.xhtml.forEach(item => {
      itemref.push({
        '@idref': item.id
      })
    })

    return { itemref }
  }

  get metadata () {
    const book = this.book // TODO: validate this with Joi?

    const meta = []
    const link = []

    const metadata = {
      '@xmlns:dc': 'http://purl.org/dc/elements/1.1/',
      'dc:identifier': {
        '@id': 'uid',
        '#text': book['identifier']
      },
      'dc:language': {
        '#text': book['language'] || 'en-US'
      }
    }

    if (book['title']) {
      metadata['dc:title'] = {
        '@id': 'title',
        '#text': book['title']
      }
    }

    if (book['updated']) {
      meta.push({
        '@property': 'dcterms:modified',
        '#text': new Date(book['updated']).toISOString().replace(/\.\d+Z$/, 'Z')
      })
    }

    if (book['licenseURL']) {
      link.push({
        '@rel': 'cc:license',
        '@href': book['licenseURL']
      })
    }

    if (book['contributors']) {
      metadata['dc:contributor'] = book['contributors'].map(contributor => ({
        '#text': contributor.name
      }))
    }

    if (meta.length) {
      metadata.meta = meta
    }

    if (link.length) {
      metadata.link = link
    }

    return metadata
  }

  // note: not actually checking the namespaces
  properties ($) {
    const selectors = {
      scripted: 'script, form, :input',
      mathml: 'math, mml\\:math',
      svg: 'svg, svg\\:svg'
    }

    return Object.keys(selectors).reduce((output, type) => {
      if ($(selectors[type]).length) {
        output.push(type)
      }

      return output
    }, [])
  }
}

module.exports = HTMLEPUB
