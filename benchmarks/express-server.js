import express from "express" 
const app = express()

app.get('/', (req, res) => {
  res.send("hello world\n");
})

app.listen('1235', '127.0.0.1', () => {
  console.log("Express is Ready ...")
  })