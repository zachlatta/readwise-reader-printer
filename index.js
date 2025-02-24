import { JSONFilePreset } from 'lowdb/node'
import ReadwiseReaderAPI from './readwiseReader.js'
import { print, getPrinters} from 'unix-print'

console.log('Starting Readwise Reader Printer service...')

const PRINTER_NAME = process.env.PRINTER_NAME
if (!PRINTER_NAME) {
  console.error('PRINTER_NAME environment variable not set')
  process.exit(1)
}

if (!process.env.API_KEY) {
  console.error('API_KEY environment variable not set')
  process.exit(1)
}

console.log(`Initializing Readwise Reader API with printer: ${PRINTER_NAME}`)
const reader = new ReadwiseReaderAPI(process.env.API_KEY)

let oneHourAgo = new Date(Date.now() - 1*60*60*1000)
const dbDefaultData = {
  lastChecked: oneHourAgo.toISOString(),
  processedArticles: []
}
console.log('Initializing database...')
const db = await JSONFilePreset('db.json', dbDefaultData)
console.log(`Database loaded. Last check time: ${db.data.lastChecked}`)

console.log('Fetching available printers...')
const printers = await getPrinters()
if (!printers.find(p => p.printer === PRINTER_NAME)) {
  console.error(`Printer ${PRINTER_NAME} not found`)
  console.log('Available printers:')
  console.log(printers)
  throw new Error(`Printer ${PRINTER_NAME} not found`)
}
console.log(`Found printer: ${PRINTER_NAME}`)

console.log(`Fetching documents updated after ${db.data.lastChecked}...`)
const articles = await reader.getDocuments( { updatedAfter: db.data.lastChecked });
console.log(`Found ${articles.length} total articles`)
db.data.lastChecked = new Date().toISOString()

// filter out articles already in db
const newArticles = articles.filter(article => !db.data.processedArticles.includes(article.source_url))
console.log(`Found ${newArticles.length} new articles to process`)

for (const article of newArticles) {
  console.log(`\nProcessing article: ${article.source_url}`)
  
  // fetch and get content-type of article.source_url
  console.log('Fetching article content...')
  const response = await fetch(article.source_url)
  const contentType = response.headers.get('content-type')
  console.log(`Content type: ${contentType}`)

  const pdfPath = `readwise-reader-printer.pdf`

  // if the file is a pdf, download it. if it's a website, run percollate to generate PDF
  if (contentType.includes('application/pdf')) {
    console.log('Article is PDF, downloading directly...')
    const pdf = await response.arrayBuffer()
    await Bun.write(pdfPath, pdf)
    console.log('PDF downloaded successfully')
  } else {
    console.log('Article is webpage, converting to PDF with percollate...')
    const proc = Bun.spawn(["bun", "run", "percollate", "pdf", "--css", "@page { size: letter }", "--output", pdfPath, article.source_url], {
      stdio: ["inherit", "inherit", "inherit"]
    })

    // wait for process to complete
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      console.error(`Percollate failed with exit code ${exitCode}`)
      throw new Error(`Process exited with code ${exitCode}`)
    }
    console.log('PDF generated successfully')
  }

  console.log(`Sending PDF to printer: ${PRINTER_NAME}`)
  await print(pdfPath, PRINTER_NAME)
  console.log('Print job sent successfully')

  console.log('Waiting 5 seconds before cleanup...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  // delete pdf
  console.log('Cleaning up temporary PDF file...')
  await Bun.file(pdfPath).delete()
  console.log('PDF file deleted')

  // add processed article to db
  if (!db.data.processedArticles.includes(article.source_url)) {
    db.data.processedArticles.push(article.source_url)
    console.log('Article marked as processed in database')
  }
}

console.log('\nSaving database...')
await db.write()
console.log('Database saved successfully')
console.log('Processing complete!')

