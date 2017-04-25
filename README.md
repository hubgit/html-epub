# html-epub

## Install

```
npm install html-epub
```

or

```
yarn add html-epub
```

## Example usage in Express

```js
app.use('/books/:book/epub', (req, res, next) => {
    // book must have `identifier`, `title` and `updated` properties
    const book = BookService.get(req.params.book)

    // each part must have `title` and `content` (HTML) properties
    const parts = book.chapters.map(chapter => ({
      title: chapter.title,
      content: chapter.source
    }))

    // the base path for relative image URLs
    const resourceRoot = path.join(__dirname, 'uploads')

    const epub = new HTMLEPUB(book, {resourceRoot})

    // pipe the zip file to the response stream
    epub.load(parts).then(() => epub.stream(res))
})
```
