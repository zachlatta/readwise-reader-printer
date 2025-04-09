import { JSONFilePreset } from 'lowdb/node'
import ReadwiseReaderAPI from './readwiseReader.js'
import { print, getPrinters } from 'unix-print'

console.log('Starting Readwise Reader Printer service...')

const PRINT_OPTIONS = [ '-o sides=two-sided-long-edge' ]

if (!process.env.API_KEY) {
  console.error('API_KEY environment variable not set')
  process.exit(1)
}

console.log('Initializing Readwise Reader API...')
const reader = new ReadwiseReaderAPI(process.env.API_KEY)

let oneHourAgo = new Date(Date.now() - 1*60*60*1000)
const dbDefaultData = {
  lastChecked: oneHourAgo.toISOString(),
  processedArticles: []
}
console.log('Initializing database...')
const db = await JSONFilePreset('db.json', dbDefaultData)
console.log(`Database loaded. Last check time: ${db.data.lastChecked}`)

let PRINTER_NAME = process.env.PRINTER_NAME
// if env is not avaliable, let user choose printer
if (!PRINTER_NAME) {
  console.log('environment variable not set')
  console.log('Fetching available printers...')
  const printers = await getPrinters()
  
  if (printers.length === 0) {
    console.error('No printers found!')
    process.exit(1)
  }

  console.log('\nAvailable printers:')
  printers.forEach((printer, index) => {
    console.log(`${index + 1}. ${printer.description} (${printer.printer}) - ${printer.status}`)
  })

  PRINTER_NAME = await selectPrinter()
} else {
  // check if printer exists
  const isValid = await checkPrinter(PRINTER_NAME)
  if (!isValid) {
    console.error(`Printer ${PRINTER_NAME} not found`)
    process.exit(1)
  }
}

console.log(`Selected printer: ${PRINTER_NAME}`)

console.log(`Fetching documents updated after ${db.data.lastChecked}...`)
const articles = await reader.getDocuments( { updatedAfter: db.data.lastChecked });
console.log(`Found ${articles.length} total articles`)
db.data.lastChecked = new Date().toISOString()

// filter out articles already in db
const newArticles = articles.filter(article => !db.data.processedArticles.includes(article.source_url))
console.log(`Found ${newArticles.length} new articles to process`)

for (const article of newArticles) {
  if (!article.source_url) {
    console.log('Skipping article with no source_url')
    continue
  }
  
  console.log(`\nProcessing article: ${article.source_url}`)
  
  if (article.source_url.includes('mailto')) {
    console.log('Skipping mailto link')
    continue
  }
  
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
  await print(pdfPath, PRINTER_NAME, PRINT_OPTIONS)
  console.log('Print job sent successfully')

  console.log('Waiting 5 seconds before cleanup...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  console.log('Cleaning up temporary PDF file...')
  await Bun.file(pdfPath).delete()
  console.log('PDF file deleted')

  if (!db.data.processedArticles.includes(article.source_url)) {
    db.data.processedArticles.push(article.source_url)
    console.log('Article marked as processed in database')
    
    console.log('Saving database after processing article...')
    await db.write()
    console.log('Database saved successfully')
  }
}

console.log('\nAll articles processed. Confirming final database state...')
await db.write()
console.log('Processing complete!')

async function selectPrinter() {
  const printers = await getPrinters()
  
  if (printers.length === 0) {
    console.error('No printers found!')
    process.exit(1)
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(printers.length === 1 
      ? `\nDo you want to use ${printers[0].description}? (y/n): ` 
      : `\nSelect printer number (1-${printers.length}): `, (answer) => {
      rl.close()
      
      if (printers.length === 1) {
        if (answer.toLowerCase() === 'y') {
          resolve(printers[0].printer)
        } else if (answer.toLowerCase() === 'n') {
          console.error('No other printers found!')
          process.exit(1)
        } else {
          console.error('Invalid selection.')
          process.exit(1)
        }
      } else {
        const selectedIndex = parseInt(answer) - 1
        
        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= printers.length) {
          console.error('Invalid selection.')
          process.exit(1)
        }
        
        resolve(printers[selectedIndex].printer)
      }
    })
  })
}

async function checkPrinter(printerName) {
  const printers = await getPrinters()
  const printerExists = printers.some(p => p.printer === printerName)
  if (!printerExists) {
    console.error(`Printer ${printerName} not found`)
    console.log('Available printers:')
    console.log(printers)
    return false
  }
  return true
}

