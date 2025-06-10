const express = require("express");
const mysql = require("mysql2");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");


dotenv.config();

const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: "secretkey",
    resave: false,
    saveUninitialized: true,
  })
);

//Database Connection
const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "mysql@123",
  database: process.env.DB_NAME || "car_rental1",
});

db.connect((err) => {
  if (err) console.error("Database connection failed: " + err.stack);
  else console.log("Connected to MySQL Database.");
});

// Home Route
app.get("/", (req, res) => {
  res.render("login");
});

// REGISTER ROUTE
app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  db.query(
    "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
    [name, email, hashedPassword, role],
    (err, result) => {
      if (err) return res.send("Error: " + err);
      res.redirect("/login");
    }
  );
});

// LOGIN ROUTE
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
    if (err || results.length === 0) return res.send("User not found");

    const match = await bcrypt.compare(password, results[0].password);
    if (!match) return res.send("Invalid password");

    req.session.user = results[0];

    // Redirect based on role
    if (results[0].role === "admin") {
      res.redirect("/admin-dashboard");
    } else {
      res.redirect("/user-dashboard");
    }
  });
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// USER DASHBOARD
app.get("/user-dashboard", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    db.query("SELECT * FROM cars", (err, cars) => {
        if (err) return res.send("Error fetching cars: " + err);
        res.render("user_dashboard", { cars: cars });
    });
});


// ADMIN DASHBOARD
app.get("/admin-dashboard", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") return res.redirect("/login");

  db.query("SELECT * FROM cars", (err, results) => {
    if (err) return res.send("Error: " + err);
    res.render("admin_dashboard", { user: req.session.user, cars: results });
  });
});


// Set up Multer for image uploads
const storage = multer.diskStorage({
    destination: "./public/uploads/",
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname)); // Rename file to prevent conflicts
    },
  });
  const upload = multer({ storage: storage });
  
  // Route to Add Car (Admin Only)
  app.get("/add-car", (req, res) => {
    if (!req.session.user || req.session.user.role !== "admin") return res.redirect("/login");
    res.render("add_car");
  });
  
  app.post("/add-car", upload.single("image"), (req, res) => {
    const { brand, model, price,kilometers } = req.body;
    const image = req.file.filename; // Get uploaded image filename
  
    db.query(
      "INSERT INTO cars (brand, model, price, image,kilometers) VALUES (?, ?, ?, ?, ?)",
      [brand, model, price, image,kilometers],
      (err, result) => {
        if (err) return res.send("Error: " + err);
        res.redirect("/admin-dashboard");
      }
    );
  });


  // Show Car Booking Page
app.get("/book-car/:id", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const carId = req.params.id;
    db.query("SELECT * FROM cars WHERE id = ?", [carId], (err, result) => {
        if (err || result.length === 0) return res.send("Car not found.");
        res.render("book_car", { car: result[0] });
    });
});

// Handle Booking Submission
app.post("/book-car/:id", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const carId = req.params.id;
    const { start_date, end_date } = req.body;
    const userId = req.session.user.id;

    // Fetch car price
    db.query("SELECT price FROM cars WHERE id = ?", [carId], (err, result) => {
        if (err || result.length === 0) return res.send("Car not found.");
        
        const pricePerDay = result[0].price;
        const totalDays = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24));
        const totalPrice = totalDays * pricePerDay;

        db.query(
            "INSERT INTO bookings (user_id, car_id, start_date, end_date, total_price, status) VALUES (?, ?, ?, ?, ?, 'Pending')",
            [userId, carId, start_date, end_date, totalPrice],
            (err, result) => {
                if (err) return res.send("Error booking car: " + err);
                res.redirect("/my-bookings");
            }
        );
    });
});


// Show User's Bookings
app.get("/my-bookings", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    db.query(
        "SELECT bookings.*, cars.brand, cars.model FROM bookings INNER JOIN cars ON bookings.car_id = cars.id WHERE bookings.user_id = ?",
        [req.session.user.id],
        (err, result) => {
            if (err) return res.send("Error fetching bookings: " + err);
            res.render("my_bookings", { bookings: result });
        }
    );
});

app.get("/payment-confirmation", (req, res) => {
    res.render("payment_confirmation");
  });

// Show Payment Page for Booking
app.get("/payment/:id", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const bookingId = req.params.id;

    db.query(
        "SELECT bookings.*, cars.brand, cars.model FROM bookings INNER JOIN cars ON bookings.car_id = cars.id WHERE bookings.id = ? AND bookings.user_id = ?",
        [bookingId, req.session.user.id],
        (err, result) => {
            if (err || result.length === 0) return res.send("Booking not found.");
            res.render("payment", { booking: result[0] });
        }
    );
});

// Handle Payment Confirmation
app.post("/payment/:id", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const bookingId = req.params.id;

    // Simulate payment processing
    const { paymentMethod } = req.body;

    // In real-world, payment gateway would be integrated here (like Stripe, PayPal)
    // For this demo, we directly mark the payment as 'Paid' if a payment method is selected
    if (!paymentMethod) {
        return res.send("Please select a payment method.");
    }

    // Update booking status to "Paid" and change payment status
    db.query(
        "UPDATE bookings SET status = 'Confirmed', payment_status = 'Paid' WHERE id = ? AND user_id = ?",
        [bookingId, req.session.user.id],
        (err, result) => {
            if (err) return res.send("Error updating payment: " + err);
            res.redirect("/payment-confirmation");
        }
    );
});

// Admin route to view all bookings
app.get("/admin/view-bookings", (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect("/login"); // Redirect if not logged in as Admin
    }

    // Query to fetch all bookings (including car and user details)
    db.query(
        `SELECT bookings.start_date, bookings.end_date, bookings.total_price, bookings.id, bookings.status, bookings.payment_status, cars.brand, cars.model, users.name, users.email
         FROM bookings
         JOIN cars ON bookings.car_id = cars.id
         JOIN users ON bookings.user_id = users.id
         ORDER BY bookings.id DESC `,
        (err, bookings) => {
            if (err) {
                console.log("Error fetching bookings:", err);
                return res.send("Error fetching bookings.");
            }

            // Render the admin view bookings page with the data
            res.render("admin_view_bookings", { bookings });
        }
    );
});



// Admin route to display the edit form
app.get("/admin/edit-car/:id", (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect("/login"); // Redirect if not logged in as Admin
    }

    const carId = req.params.id;

    // Query to fetch the car details by carId
    db.query("SELECT * FROM cars WHERE id = ?", [carId], (err, car) => {
        if (err) {
            console.log("Error fetching car details:", err);
            return res.send("Error fetching car details.");
        }

        if (car.length === 0) {
            return res.send("Car not found.");
        }

        // Render the edit car form with the car data
        res.render("admin_edit_car", { car: car[0] });
    });
});

app.post("/admin/update-car/:id", (req, res) => {
  const carId = req.params.id;
  const { brand, model, price,kilometers } = req.body; // Ensure req.body contains values

  const sql = "UPDATE cars SET brand = ?, model = ?, price = ? ,kilometers = ? WHERE id = ?";
  db.query(sql, [brand, model, price, kilometers,carId], (err, result) => {
      if (err) {
          console.error("Error updating car:", err);
          res.send("Error updating car.");
      } else {
          res.redirect("/admin-dashboard");
      }
  });
});


// Admin route to delete a car
app.get("/admin/delete-car/:id", (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect("/login"); // Redirect if not logged in as Admin
    }

    const carId = req.params.id;

    // Query to delete the car by carId
    db.query("DELETE FROM cars WHERE id = ?", [carId], (err, result) => {
        if (err) {
            console.log("Error deleting car:", err);
            return res.send("Error deleting car.");
        }

        // Redirect to the car list page after deletion
        res.redirect("/admin-dashboard");
    });
});









const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

