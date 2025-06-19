const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
require("dotenv").config();
const cors = require("cors");
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-adminsdk.json');
const port = process.env.PORT || 5000;
const {
  createPayment,
  executePayment,
  queryPayment,
  searchTransaction,
  refundTransaction,
} = require("bkash-payment");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ft5am.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// middleware
app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const bkashConfig = {
  base_url: "https://tokenized.sandbox.bka.sh/v1.2.0-beta",
  username: "01770618567",
  password: "D7DaC<*E*eG",
  app_key: "0vWQuCRGiUX7EPVjQDr0EUAYtc",
  app_secret: "jcUNPBgbcqEDedNKdvE4G1cAK7D3hCjmJccNPZZBq96QIxxwAMEx",
};

const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ msessage: "forbidden access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ msessage: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const userCollection = client.db("bistroBossDb").collection("users");
    const menuCollection = client.db("bistroBossDb").collection("menu");
    const reviewCollection = client.db("bistroBossDb").collection("reviews");
    const cartCollection = client.db("bistroBossDb").collection("carts");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ msessage: "forbidden access" });
      }
      next();
    };

    // bikas related api
    app.post("/bkash-checkout", async (req, res) => {
      try {
        const { amount, callbackURL, orderID, reference } = req.body;
        const paymentDetails = {
          amount: amount || 10, // your product price
          callbackURL: callbackURL , // your callback route
          orderID: orderID || "Order_101", // your orderID
          reference: reference || "1", // your reference
        };
        const result = await createPayment(bkashConfig, paymentDetails);
       res.status(200).send(result?.bkashURL);
      } catch (e) {
        console.log(e);
      }
    });

    app.get("/bkash-callback", async (req, res) => {
      try {
        const { status, paymentID } = req.query;
        let result;
        let response = {
          statusCode: "4000",
          statusMessage: "Payment Failed",
        };
        if (status === "success")
          result = await executePayment(bkashConfig, paymentID);

        if (result?.transactionStatus === "Completed") {
          // payment success
          // insert result in your db
        }
        if (result)
          response = {
            statusCode: result?.statusCode,
            statusMessage: result?.statusMessage,
          };
        // You may use here WebSocket, server-sent events, or other methods to notify your client
        res.redirect('https://bistro-boss-dbf78.web.app')
      } catch (e) {
        console.log(e);
      }
    });

    // Add this route under admin middleware
    app.post("/bkash-refund", async (req, res) => {
      try {
        const { paymentID, trxID, amount } = req.body;
        const refundDetails = {
          paymentID,
          trxID,
          amount,
        };
        const result = await refundTransaction(bkashConfig, refundDetails);
        res.send(result);
      } catch (e) {
        console.log(e);
      }
    });

    app.get("/bkash-search", async (req, res) => {
      try {
        const { trxID } = req.query;
        const result = await searchTransaction(bkashConfig, trxID);
        res.send(result);
      } catch (e) {
        console.log(e);
      }
    });

    app.get("/bkash-query", async (req, res) => {
      try {
        const { paymentID } = req.query;
        const result = await queryPayment(bkashConfig, paymentID);
        res.send(result);
      } catch (e) {
        console.log(e);
      }
    });

    //   jwt related api
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // user realated api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ msessage: "unauthorize access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const query = { email: req.body.email };
      const exsitingUser = await userCollection.findOne(query);
      if (exsitingUser) {
        return res.send({ msessage: "user alredy exsit", insertedId: null });
      }
      const result = await userCollection.insertOne(req.body);
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      await admin.auth().deleteUser(id);
      const query = { uid: id };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // menu related api
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.get("/menus/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: id };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const menuItem = req.body;
      const result = await menuCollection.insertOne(menuItem);
      res.send(result);
    });

    app.patch("/menu/:id", async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const query = { _id: id };
      const updatedDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
          image: item.image,
        },
      };
      const result = await menuCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    // review related api
    app.get("/review", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });
    // cart collection
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("juel valo chele");
});

app.listen(port, () => {
  console.log(`bistor boss starting on port : ${port}`);
});
