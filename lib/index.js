const fs = require('fs')
const url = require('url')
const path = require('path')
const tidy = require('libtidy')
const mime = require('mime-types')
const cheerio = require('cheerio')
const archiver = require('archiver')
const builder = require('xmlbuilder')

// given an array of HTML files and the, plus metadata, generate an EPUB file
class HTMLEPUB {
  constructor (book = {}, options = {}) {
    this.book = book
    this.options = options
    this.xhtml = []
    this.images = []
  }

  load (items) {
    let counter = 0

    return Promise.all(items.map(item => {
      return this.parse(item.content).then($ => {
        const id = `page-${++counter}`
        const title = item.title || $('h1').text()
        const target = `xhtml/${id}.xhtml`

        this.xhtml.push({ id, $, title, target })

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

        inputStream = fs.createReadStream(item.source)

        archive.append(inputStream, { name: 'EPUB/' + item.target })
      })

      archive.finalize()

      resolve(archive)
    })
  }

  parse (html) {
    const epub = this

    // http://api.html-tidy.org/tidy/tidylib_api_5.2.0/quick_ref.html
    const options = {
      doctype: 'html5',
      output_xhtml: true,
      tidy_mark: false
    }

    return new Promise((resolve, reject) => {
      tidy.tidyBuffer(html, options, (err, result) => {
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

    const resourceRoot = epub.options.resourceRoot.replace(/\/?$/, '/') // ensure trailing slash

    let counter = 0

    // NOTE: must use `function` so that `this` is set by cheerio
    $('img[src]').each((index, node) => {
      const $node = $(node)
      const id = `image-${++counter}`

      const src = $node.attr('src').replace(/^\//, '') // ensure no leading slash
      const source = url.resolve(resourceRoot, src)

      if (source.indexOf(resourceRoot) !== 0) {
        throw new Error('Resource is outside the resource root')
      }

      const ext = path.extname(src)
      const target = `images/${id}${ext}`
      const mimetype = mime.lookup(src)

      epub.images.push({ id, source, mimetype, target })

      $node.attr('src', '../' + target)
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
        '@media-type': file.mimetype
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
    const updated = book['updated'] ? new Date(book['updated']) : new Date()

    const metadata = {
      '@xmlns:dc': 'http://purl.org/dc/elements/1.1/',
      'dc:identifier': {
        '@id': 'uid',
        '#text': book['identifier'] // TODO: default to uuid()?
      },
      'dc:language': {
        '#text': book['language'] || 'en-US'
      },
      'dc:title': {
        '@id': 'title',
        '#text': book['title']
      },
      meta: [
        {
          '@property': 'dcterms:modified',
          '#text': updated.toISOString().replace(/\.\d+Z$/, 'Z') // TODO: use moment?
        }
      ],
      link: [
        {
          '@rel': 'cc:license',
          '@href': book['licenseURL'] || ''
        }
      ]
    }

    // other metadata

    if (book['contributors']) {
      metadata['dc:contributor'] = book['contributors'].map(contributor => ({
        '#text': contributor.name
      }))
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
