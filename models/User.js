const mongoose = require("mongoose");
mongoose.set("useCreateIndex", true);
mongoose.set("useUnifiedTopology", true);

const userSchema = new mongoose.Schema({
    chat_id: Number,
    username: String,
    position: String,
    paymentPass: String,
    isadmin: Boolean,
    language: String,
    pagination: Number,
    message: Array,
    menumessage: Array,
});

const User = mongoose.model("User", userSchema);

module.exports = User;
