import { JSONFilePreset } from 'lowdb/node'
import ReadwiseReaderAPI from './readwiseReader.js'
import { print, getPrinters} from 'unix-print'

const PRINTER_NAME = process.env.PRINTER_NAME


const reader = new ReadwiseReaderAPI(process.env.API_KEY)

let oneHourAgo = new Date(Date.now() - 1*60*60*1000)
const dbDefaultData = {
  lastChecked: oneHourAgo.toISOString(),
  processedArticles: []
}
const db = await JSONFilePreset('db.json', dbDefaultData)

const printers = await getPrinters()
if (!printers.find(p => p.printer === PRINTER_NAME)) {
  console.error(`Printer ${PRINTER_NAME} not found`)
  // available printers
  console.log('Available printers:')
  console.log(printers)
  throw new Error(`Printer ${PRINTER_NAME} not found`)
}

// TODO change updatedAfter to db.data.lastChecked
const articles = await reader.getDocuments( { updatedAfter: db.data.lastChecked });
db.data.lastChecked = new Date().toISOString()

// filter out articles already in db
const newArticles = articles.filter(article => !db.data.processedArticles.includes(article.source_url))

for (const article of newArticles) {
  // fetch and get content-type of article.source_url
  const response = await fetch(article.source_url)
  const contentType = response.headers.get('content-type')
  console.log(contentType)

  const pdfPath = `readwise-reader-printer.pdf`

  // if the file is a pdf, download it. if it's a website, run percollate to generate PDF
  if (contentType.includes('application/pdf')) {
    // download pdf to to_print.pdf
    const pdf = await response.arrayBuffer()
    await Bun.write(pdfPath, pdf)
  } else {
    // run percollate to generate PDF
    const proc = Bun.spawn(["bun", "run", "percollate", "pdf", "--css", "@page { size: letter }", "--output", pdfPath, article.source_url], {
      stdio: ["inherit", "inherit", "inherit"]
    })

    // wait for process to complete
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      throw new Error(`Process exited with code ${exitCode}`)
    }
  }

  await print(pdfPath, PRINTER_NAME)

  // wait 5 seconds
  await new Promise(resolve => setTimeout(resolve, 5000))

  // delete pdf
  await Bun.file(pdfPath).delete()

  // add processed article to db
  if (!db.data.processedArticles.includes(article.source_url)) {
    db.data.processedArticles.push(article.source_url)
  }
}
await db.write()

